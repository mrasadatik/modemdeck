import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createSqliteRepository } from '../src/infrastructure/persistence/sqlite-repository.js';
import type { ModemDatabase } from '../src/domain/entities/types.js';
const base = path.join(process.cwd(), '.test-sqlite');
const empty = (): ModemDatabase => ({
  sms: [],
  sent: [],
  calls: [],
  ussd: [],
  contacts: [],
  parts: {},
  seen: {},
});
import { decryptText } from '../src/infrastructure/crypto/vault.js';

const testKey = Buffer.alloc(32, 7);
fs.mkdirSync(base, { recursive: true });
const file = path.join(base, `case-${Date.now()}.sqlite`);
const repository = createSqliteRepository(file, empty(), { getKey: () => testKey });
repository.state.sms.push({ id: 'a', from: '+1', ts: new Date().toISOString(), text: 'secret' });
await repository.save();
await repository.audit?.({ action: 'test', detail: 'ok' });
const db = new Database(file);
if ((db.prepare('SELECT version FROM schema_version').get() as { version: number }).version !== 1)
  process.exit(1);
const row = db.prepare("SELECT payload FROM records WHERE kind='sms'").get() as { payload: string };
const decrypted = decryptText(testKey, row.payload);
if (!decrypted || JSON.parse(decrypted).text !== '[redacted]') process.exit(1);
if (
  (db.prepare('SELECT count(*) AS count FROM audit_events').get() as { count: number }).count !== 1
)
  process.exit(1);
db.close();
repository.close?.();
const reloaded = createSqliteRepository(file, empty(), { getKey: () => testKey });
if (reloaded.state.sms[0]?.text !== '[redacted]') process.exit(1);
reloaded.close?.();
fs.rmSync(file, { force: true });
fs.rmSync(`${file}-wal`, { force: true });
fs.rmSync(`${file}-shm`, { force: true });
const retention = path.join(base, `retention-${Date.now()}.sqlite`);
const retained = createSqliteRepository(retention, empty(), {
  retentionDays: 1,
  persistSensitive: true,
  getKey: () => testKey,
});
retained.state.sms.push({
  id: 'old',
  from: '+1',
  ts: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  text: 'old',
});
await retained.save();
const check = new Database(retention);
if (
  (
    check.prepare("SELECT count(*) AS count FROM records WHERE kind='sms'").get() as {
      count: number;
    }
  ).count !== 0
)
  process.exit(1);
check.close();
retained.close?.();
fs.rmSync(retention, { force: true });
fs.rmSync(`${retention}-wal`, { force: true });
fs.rmSync(`${retention}-shm`, { force: true });
