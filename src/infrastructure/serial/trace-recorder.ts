import fs from 'node:fs';
import path from 'node:path';
import type { SerialTransportPort } from '../../domain/ports/serial-transport.js';

export interface TraceRecord {
  direction: 'in' | 'out';
  data: string;
  timestamp: string;
}
export function createTraceRecorder(
  transport: SerialTransportPort,
  file: string,
  enabled: boolean,
): SerialTransportPort {
  if (!enabled) return transport;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const append = (direction: TraceRecord['direction'], data: string): void => {
    fs.appendFileSync(
      file,
      `${JSON.stringify({ direction, data, timestamp: new Date().toISOString() } satisfies TraceRecord)}\n`,
      'utf8',
    );
  };
  const originalWrite = transport.write.bind(transport);
  transport.write = (data: string | Buffer): void => {
    append('out', Buffer.isBuffer(data) ? data.toString('base64') : data);
    originalWrite(data);
  };
  transport.on('data', (data) => append('in', Buffer.from(data).toString('base64')));
  return transport;
}
