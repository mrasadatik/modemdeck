import Database from 'better-sqlite3';
import fs from 'node:fs';
import { dirname } from 'node:path';
import type { ModemDatabase } from '../../domain/entities/types.js';
import type { Repository } from '../../domain/ports/repository.js';
import { decryptText, encryptText, isEnvelope } from '../crypto/vault.js';
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
  options: {
    persistSensitive?: boolean;
    retentionDays?: number;
    getKey?: () => Buffer | null;
    onEncrypted?: () => void;
  } = {},
): Repository<ModemDatabase> {
  fs.mkdirSync(dirname(path), { recursive: true });
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

  // Prepared once and reused: short-lived statement handles are a
  // finalization hazard on some runtimes.
  const selectRecords = db.prepare('SELECT kind, id, payload FROM records');
  const deleteRecords = db.prepare('DELETE FROM records');
  const insertRecord = db.prepare(
    'INSERT INTO records(kind,id,payload,created_at) VALUES (?,?,?,?)',
  );
  const deleteRetention = db.prepare(
    "DELETE FROM records WHERE julianday(created_at) < julianday('now', ? || ' days')",
  );
  const insertAudit = db.prepare(
    'INSERT INTO audit_events(action, correlation_id, detail, created_at) VALUES (?, ?, ?, ?)',
  );

  const snapshot = structuredClone(defaults);
  const decodePayloads = (key: Buffer | null): void => {
    const rows = selectRecords.all() as Array<{
      kind: string;
      id: string;
      payload: string;
    }>;
    for (const row of rows) {
      try {
        const raw = isEnvelope(row.payload)
          ? key
            ? decryptText(key, row.payload)
            : null
          : row.payload;
        if (!raw) continue;
        const value: unknown = JSON.parse(raw);
        if (row.kind === 'sms' && sms(value)) snapshot.sms.push(value);
        else if (row.kind === 'sent' && sent(value)) snapshot.sent.push(value);
        else if (row.kind === 'calls' && call(value)) snapshot.calls.push(value);
        else if (row.kind === 'ussd' && ussd(value)) snapshot.ussd.push(value);
        else if (row.kind === 'contact' && record(value)) snapshot.contacts.push(value as never);
        else if (row.kind === 'seen') snapshot.seen[row.id] = 1;
        else if (row.kind === 'part' && record(value)) {
          const entries: Array<[number, string]> = [];
          for (const [key2, item] of Object.entries(value))
            if (/^\d+$/.test(key2) && typeof item === 'string') entries.push([Number(key2), item]);
          if (entries.length === Object.keys(value).length)
            snapshot.parts[row.id] = Object.fromEntries(entries);
        }
      } catch {
        /* corrupted rows are ignored, not allowed to crash startup */
      }
    }
  };
  decodePayloads(options.getKey?.() ?? null);
  const persistTransaction = db.transaction(() => {
    const key = options.getKey?.();
    deleteRecords.run();
    const sensitive = options.persistSensitive === true;
    const sms = snapshot.sms
      .slice(0, 5000)
      .map((item) => (sensitive ? item : { ...item, text: '[redacted]' }));
    for (const item of sms)
      insertRecord.run(
        'sms',
        item.id,
        encryptText(options.getKey!()!, JSON.stringify(item)),
        item.ts?.slice(0, 10),
      );
    for (const item of snapshot.sent.slice(0, 5000))
      insertRecord.run(
        'sent',
        `${item.ts}-${item.to}`,
        key
          ? encryptText(key, JSON.stringify(sensitive ? item : { ...item, text: '[redacted]' }))
          : JSON.stringify(sensitive ? item : { ...item, text: '[redacted]' }),
        item.ts?.slice(0, 10),
      );
    for (const item of snapshot.calls.slice(0, 5000))
      insertRecord.run(
        'calls',
        `${item.ts}-${item.number}`,
        key ? encryptText(key, JSON.stringify(item)) : JSON.stringify(item),
        item.ts?.slice(0, 10),
      );
    for (const item of snapshot.ussd.slice(0, 1000))
      insertRecord.run(
        'ussd',
        `${item.ts}-${item.code}`,
        key
          ? encryptText(key, JSON.stringify(sensitive ? item : { ...item, text: '[redacted]' }))
          : JSON.stringify(sensitive ? item : { ...item, text: '[redacted]' }),
        item.ts?.slice(0, 10),
      );
    for (const item of snapshot.contacts.slice(0, 5000))
      insertRecord.run(
        'contact',
        `${item.simId ?? ''}-${item.index}`,
        key ? encryptText(options.getKey!()!, JSON.stringify(item)) : JSON.stringify(item),
        new Date().toISOString(),
      );
    for (const id of Object.keys(snapshot.seen).slice(-10000))
      insertRecord.run('seen', id, '1', new Date().toISOString().slice(0, 10));
    for (const [id, value] of Object.entries(snapshot.parts))
      insertRecord.run(
        'part',
        id,
        key ? encryptText(key, JSON.stringify(value)) : JSON.stringify(value),
        new Date().toISOString(),
      );
    if (options.retentionDays && options.retentionDays > 0) {
      deleteRetention.run(`-${Math.floor(options.retentionDays)}`);
    }
  });
  const persist = (): void => {
    if (!options.getKey?.()) return; // locked: never write plaintext or wipe stored ciphertext
    persistTransaction();
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
      snapshot.contacts = structuredClone(next.contacts);
      snapshot.parts = structuredClone(next.parts);
      snapshot.seen = structuredClone(next.seen);
      persist();
    },
    close: () => db.close(),
    unlock: (key: Buffer): void => {
      snapshot.sms.length = 0;
      snapshot.sent.length = 0;
      snapshot.calls.length = 0;
      snapshot.ussd.length = 0;
      snapshot.contacts.length = 0;
      for (const k of Object.keys(snapshot.parts)) delete snapshot.parts[k];
      for (const k of Object.keys(snapshot.seen)) delete snapshot.seen[k];
      decodePayloads(key);
    },
    lock: (): void => {
      snapshot.sms.length = 0;
      snapshot.sent.length = 0;
      snapshot.calls.length = 0;
      snapshot.ussd.length = 0;
      snapshot.contacts.length = 0;
      for (const k of Object.keys(snapshot.parts)) delete snapshot.parts[k];
      for (const k of Object.keys(snapshot.seen)) delete snapshot.seen[k];
    },
    audit: async (event) => {
      const key = options.getKey?.();
      insertAudit.run(
        event.action,
        event.correlationId || null,
        event.detail && key
          ? encryptText(key, event.detail)
          : event.detail && !key
            ? null
            : event.detail || null,
        new Date().toISOString(),
      );
    },
  };
  return repository;
}
