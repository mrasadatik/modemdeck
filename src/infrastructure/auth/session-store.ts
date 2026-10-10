import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';

export interface SessionRecord {
  id: string;
  createdAt: number;
  lastSeenAt: number;
  simId: string;
  via: string;
  label: string;
  revoked: boolean;
  revokeReason: string;
}

export interface SessionLimits {
  /** Idle milliseconds before a session lapses; 0 disables. */
  idleMs: number;
  /** Milliseconds after creation before a session expires; 0 disables. */
  maxAgeMs: number;
}

const row = (value: unknown): SessionRecord | null => {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string') return null;
  return {
    id: record.id,
    createdAt: typeof record.created_at === 'number' ? record.created_at : 0,
    lastSeenAt: typeof record.last_seen_at === 'number' ? record.last_seen_at : 0,
    simId: typeof record.sim_id === 'string' ? record.sim_id : '',
    via: typeof record.via === 'string' ? record.via : '',
    label: typeof record.label === 'string' ? record.label : '',
    revoked: (record.revoked as number) === 1,
    revokeReason: typeof record.revoke_reason === 'string' ? record.revoke_reason : '',
  };
};

/**
 * SQLite-backed session registry. Every unlock (setup, login, recovery)
 * mints a session row; lock, logout, expiry and idle sweeps revoke rows.
 * Rows carry metadata only — never key material, which stays in memory —
 * so a restart still forces re-authentication.
 *
 * Statements are prepared once and reused: short-lived statement handles
 * are a finalization hazard on some runtimes.
 */
export class SessionManager {
  private readonly db: Database.Database;
  private readonly insertStmt: Database.Statement;
  private readonly getStmt: Database.Statement;
  private readonly touchStmt: Database.Statement;
  private readonly revokeStmt: Database.Statement;
  private readonly revokeAllStmt: Database.Statement;
  private readonly liveStmt: Database.Statement;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      sim_id TEXT NOT NULL DEFAULT '',
      via TEXT NOT NULL DEFAULT '',
      label TEXT NOT NULL DEFAULT '',
      revoked INTEGER NOT NULL DEFAULT 0,
      revoke_reason TEXT NOT NULL DEFAULT '');`);
    this.db.exec('CREATE INDEX IF NOT EXISTS sessions_last_seen ON sessions(last_seen_at);');
    this.insertStmt = this.db.prepare(
      'INSERT INTO sessions(id,created_at,last_seen_at,sim_id,via,label,revoked,revoke_reason) VALUES (?,?,?,?,?,?,0,?)',
    );
    this.getStmt = this.db.prepare('SELECT * FROM sessions WHERE id = ?');
    this.touchStmt = this.db.prepare(
      'UPDATE sessions SET last_seen_at = ? WHERE id = ? AND revoked = 0',
    );
    this.revokeStmt = this.db.prepare(
      'UPDATE sessions SET revoked = 1, revoke_reason = ?, last_seen_at = ? WHERE id = ?',
    );
    this.revokeAllStmt = this.db.prepare(
      'UPDATE sessions SET revoked = 1, revoke_reason = ?, last_seen_at = ? WHERE revoked = 0',
    );
    this.liveStmt = this.db.prepare('SELECT * FROM sessions WHERE revoked = 0');
  }

  create(options: { simId?: string; via: string; label?: string; now?: number }): SessionRecord {
    const now = options.now ?? Date.now();
    const record: SessionRecord = {
      id: randomBytes(16).toString('hex'),
      createdAt: now,
      lastSeenAt: now,
      simId: options.simId ?? '',
      via: options.via,
      label: options.label ?? '',
      revoked: false,
      revokeReason: '',
    };
    this.insertStmt.run(
      record.id,
      record.createdAt,
      record.lastSeenAt,
      record.simId,
      record.via,
      record.label,
      record.revokeReason,
    );
    return record;
  }

  get(id: string): SessionRecord | null {
    if (!/^[a-f0-9]{32}$/.test(id)) return null;
    return row(this.getStmt.get(id));
  }

  /** Refresh activity; returns false when the session is gone or revoked. */
  touch(id: string, now = Date.now()): boolean {
    if (!/^[a-f0-9]{32}$/.test(id)) return false;
    const changed = this.touchStmt.run(now, id);
    return changed.changes === 1;
  }

  revoke(id: string, reason: string, now = Date.now()): boolean {
    if (!/^[a-f0-9]{32}$/.test(id)) return false;
    const changed = this.revokeStmt.run(reason, now, id);
    return changed.changes === 1;
  }

  revokeAll(reason: string, now = Date.now()): number {
    const changed = this.revokeAllStmt.run(reason, now);
    return Number(changed.changes);
  }

  live(now = Date.now()): SessionRecord[] {
    void now;
    const rows = this.liveStmt.all() as unknown[];
    const out: SessionRecord[] = [];
    for (const value of rows) {
      const record = row(value);
      if (record) out.push(record);
    }
    return out;
  }

  /** Validate one session against revocation, SIM binding and limits. */
  validate(
    id: string,
    options: { simId?: string; limits?: SessionLimits; now?: number } = {},
  ): { ok: true; session: SessionRecord } | { ok: false; reason: string } {
    const now = options.now ?? Date.now();
    const session = this.get(id);
    if (!session || session.revoked) return { ok: false, reason: 'revoked' };
    if (options.simId && session.simId && session.simId !== options.simId)
      return { ok: false, reason: 'sim-mismatch' };
    const limits = options.limits ?? { idleMs: 0, maxAgeMs: 0 };
    if (limits.maxAgeMs > 0 && now - session.createdAt > limits.maxAgeMs) {
      this.revoke(id, 'expired', now);
      return { ok: false, reason: 'expired' };
    }
    if (limits.idleMs > 0 && now - session.lastSeenAt > limits.idleMs) {
      this.revoke(id, 'idle', now);
      return { ok: false, reason: 'idle' };
    }
    return { ok: true, session };
  }

  /**
   * Revoke every lapsed session. Returns what was revoked so callers can
   * react (status emit, key wipe when nothing remains).
   */
  sweep(options: { limits: SessionLimits; simId?: string; now?: number }): {
    idle: number;
    expired: number;
    simChanged: number;
  } {
    const now = options.now ?? Date.now();
    const { idleMs, maxAgeMs } = options.limits;
    let idle = 0;
    let expired = 0;
    let simChanged = 0;
    for (const session of this.live()) {
      if (options.simId && session.simId && session.simId !== options.simId) {
        this.revoke(session.id, 'sim-changed', now);
        simChanged += 1;
      } else if (maxAgeMs > 0 && now - session.createdAt > maxAgeMs) {
        this.revoke(session.id, 'expired', now);
        expired += 1;
      } else if (idleMs > 0 && now - session.lastSeenAt > idleMs) {
        this.revoke(session.id, 'idle', now);
        idle += 1;
      }
    }
    return { idle, expired, simChanged };
  }

  close(): void {
    this.db.close();
  }
}
