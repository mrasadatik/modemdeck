import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

export interface InteractionEvent {
  correlationId?: string;
  section: string;
  kind: 'section' | 'request' | 'command' | 'response' | 'state' | 'error';
  name: string;
  payload?: unknown;
  sensitive?: boolean;
}
export interface InteractionLog {
  record(event: InteractionEvent): string;
  child(section: string, correlationId?: string): InteractionScope;
  close(): void;
}
export interface InteractionScope {
  readonly correlationId: string;
  record(
    kind: InteractionEvent['kind'],
    name: string,
    payload?: unknown,
    sensitive?: boolean,
  ): void;
}
const redact = (value: unknown, sensitive: boolean): string => {
  if (sensitive) return '[redacted]';
  if (typeof value === 'string')
    return value.replace(
      /(password|pin|token|number|text|pdu)\s*[:=]\s*("[^"]*"|'[^']*'|\S+)/gi,
      '$1=[redacted]',
    );
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '[unserializable]';
  }
};
export function createInteractionLog(file: string, capturePayloads = false): InteractionLog {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.exec(
    'CREATE TABLE IF NOT EXISTS interaction_log (id INTEGER PRIMARY KEY AUTOINCREMENT, correlation_id TEXT NOT NULL, section TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, payload TEXT, created_at TEXT NOT NULL)',
  );
  const insert = db.prepare(
    'INSERT INTO interaction_log(correlation_id,section,kind,name,payload,created_at) VALUES (?,?,?,?,?,?)',
  );
  return {
    record: (event) => {
      const id = event.correlationId ?? randomUUID();
      insert.run(
        id,
        event.section,
        event.kind,
        event.name,
        capturePayloads
          ? redact(event.payload, event.sensitive === true)
          : event.payload === undefined
            ? null
            : '[captured-disabled]',
        new Date().toISOString(),
      );
      return id;
    },
    child: (section, correlationId = randomUUID()) => ({
      correlationId,
      record: (kind, name, payload, sensitive) => {
        insert.run(
          correlationId,
          section,
          kind,
          name,
          capturePayloads
            ? redact(payload, sensitive === true)
            : payload === undefined
              ? null
              : '[captured-disabled]',
          new Date().toISOString(),
        );
      },
    }),
    close: () => db.close(),
  };
}
