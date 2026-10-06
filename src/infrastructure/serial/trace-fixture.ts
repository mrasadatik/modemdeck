import fs from 'node:fs';
import type { TraceRecord } from './trace-recorder.js';
export interface Fixture {
  format: 'modemdeck-trace-v1';
  records: TraceRecord[];
  capturedAt: string;
  port?: string;
}
export function readFixture(file: string): Fixture {
  const records: TraceRecord[] = [];
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean)) {
    const value: unknown = JSON.parse(line);
    if (
      !value ||
      typeof value !== 'object' ||
      !('direction' in value) ||
      !('data' in value) ||
      !('timestamp' in value)
    )
      throw new Error('invalid trace record');
    records.push(value as TraceRecord);
  }
  return { format: 'modemdeck-trace-v1', records, capturedAt: new Date().toISOString() };
}
export async function replayFixture(
  file: string,
  onRecord: (record: TraceRecord) => Promise<void> | void,
): Promise<number> {
  const fixture = readFixture(file);
  for (const record of fixture.records) await onRecord(record);
  return fixture.records.length;
}
