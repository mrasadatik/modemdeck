import Database from 'better-sqlite3';
import type { ModemDatabase } from '../../domain/entities/types.js';
import type { Repository } from '../../domain/ports/repository.js';
import type {
  SmsMessage,
  SentMessage,
  CallRecord,
  UssdResult,
} from '../../domain/entities/types.js';
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
const sms = (value: unknown): value is SmsMessage =>
  record(value) &&
  typeof value.id === 'string' &&
  typeof value.from === 'string' &&
  typeof value.ts === 'string' &&
  typeof value.text === 'string';
const sent = (value: unknown): value is SentMessage =>
  record(value) &&
  typeof value.to === 'string' &&
  typeof value.ts === 'string' &&
  typeof value.text === 'string' &&
  typeof value.parts === 'number';
const call = (value: unknown): value is CallRecord =>
  record(value) && typeof value.number === 'string' && typeof value.ts === 'string';
const ussd = (value: unknown): value is UssdResult & { code: string; ts: string } =>
  record(value) &&
  typeof value.code === 'string' &&
  typeof value.ts === 'string' &&
  typeof value.text === 'string' &&
  typeof value.more === 'boolean' &&
  typeof value.status === 'number';

/**
 * Small transactional repository.  The application deliberately owns the
 * in-memory snapshot, while SQLite provides durability and bounded retention.
 * Values are always bound parameters (never interpolated into SQL).
 */
export function createSqliteRepository(
  path: string,
  defaults: ModemDatabase,
  options: { persistSensitive?: boolean; retentionDays?: number } = {},
): Repository<ModemDatabase> {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL,
      created_at TEXT NOT NULL, PRIMARY KEY(kind,id));
    CREATE INDEX IF NOT EXISTS records_created_at ON records(created_at);`);
  db.exec(
    'CREATE TABLE IF NOT EXISTS audit_events (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL, correlation_id TEXT, detail TEXT, created_at TEXT NOT NULL)',
  );
  const version = db.prepare('SELECT version FROM schema_version LIMIT 1').get() as
    { version: number } | undefined;
  if (!version) db.prepare('INSERT INTO schema_version(version) VALUES (?)').run(1);

  const snapshot = structuredClone(defaults);
  const rows = db.prepare('SELECT kind, id, payload FROM records').all() as Array<{
    kind: string;
    id: string;
    payload: string;
  }>;
  for (const row of rows) {
    try {
      const value: unknown = JSON.parse(row.payload);
      if (row.kind === 'sms' && sms(value)) snapshot.sms.push(value);
      else if (row.kind === 'sent' && sent(value)) snapshot.sent.push(value);
      else if (row.kind === 'calls' && call(value)) snapshot.calls.push(value);
      else if (row.kind === 'ussd' && ussd(value)) snapshot.ussd.push(value);
      else if (row.kind === 'seen') snapshot.seen[row.id] = 1;
      else if (row.kind === 'part' && record(value)) {
        const entries: Array<[number, string]> = [];
        for (const [key, item] of Object.entries(value))
          if (/^\d+$/.test(key) && typeof item === 'string') entries.push([Number(key), item]);
        if (entries.length === Object.keys(value).length)
          snapshot.parts[row.id] = Object.fromEntries(entries);
      }
    } catch {
      /* corrupted rows are ignored, not allowed to crash startup */
    }
  }
  const persist = (): void => {
    const transaction = db.transaction(() => {
      db.prepare('DELETE FROM records').run();
      const insert = db.prepare('INSERT INTO records(kind,id,payload,created_at) VALUES (?,?,?,?)');
      const sensitive = options.persistSensitive === true;
      const sms = snapshot.sms
        .slice(0, 5000)
        .map((item) => (sensitive ? item : { ...item, text: '[redacted]' }));
      for (const item of sms) insert.run('sms', item.id, JSON.stringify(item), item.ts);
      for (const item of snapshot.sent.slice(0, 5000))
        insert.run(
          'sent',
          `${item.ts}-${item.to}`,
          JSON.stringify(sensitive ? item : { ...item, text: '[redacted]' }),
          item.ts,
        );
      for (const item of snapshot.calls.slice(0, 5000))
        insert.run('calls', `${item.ts}-${item.number}`, JSON.stringify(item), item.ts);
      for (const item of snapshot.ussd.slice(0, 1000))
        insert.run(
          'ussd',
          `${item.ts}-${item.code}`,
          JSON.stringify(sensitive ? item : { ...item, text: '[redacted]' }),
          item.ts,
        );
      for (const id of Object.keys(snapshot.seen).slice(-10000))
        insert.run('seen', id, '1', new Date().toISOString());
      for (const [id, value] of Object.entries(snapshot.parts))
        insert.run('part', id, JSON.stringify(value), new Date().toISOString());
      if (options.retentionDays && options.retentionDays > 0) {
        db.prepare(
          "DELETE FROM records WHERE julianday(created_at) < julianday('now', ? || ' days')",
        ).run(`-${Math.floor(options.retentionDays)}`);
      }
    });
    transaction();
  };
  persist();
  const repository: Repository<ModemDatabase> & { close: () => void } = {
    state: snapshot,
    save: async () => persist(),
    replace: async (next: ModemDatabase) => {
      snapshot.sms = structuredClone(next.sms);
      snapshot.sent = structuredClone(next.sent);
      snapshot.calls = structuredClone(next.calls);
      snapshot.ussd = structuredClone(next.ussd);
      snapshot.parts = structuredClone(next.parts);
      snapshot.seen = structuredClone(next.seen);
      persist();
    },
    close: () => db.close(),
    audit: async (event) => {
      db.prepare(
        'INSERT INTO audit_events(action, correlation_id, detail, created_at) VALUES (?, ?, ?, ?)',
      ).run(
        event.action,
        event.correlationId || null,
        event.detail || null,
        new Date().toISOString(),
      );
    },
  };
  return repository;
}
