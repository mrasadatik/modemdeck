import fs from 'node:fs';
import path from 'node:path';
import { SerialPort } from 'serialport';
const port = process.env.MODEMDECK_PORT || process.argv[2];
const file =
  process.env.MODEMDECK_CAPTURE_PATH ||
  process.argv[3] ||
  path.join(process.cwd(), 'data', 'traces', 'live.ndjson');
if (!port) {
  console.error('Usage: npm run capture:trace -- COM3 [trace.ndjson]');
  process.exitCode = 2;
} else {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const serial = new SerialPort({
    path: port,
    baudRate: Number(process.env.MODEMDECK_BAUD || 115200),
  });
  const write = (direction: string, data: Buffer | string): void =>
    fs.appendFileSync(
      file,
      `${JSON.stringify({ direction, data: Buffer.isBuffer(data) ? data.toString('base64') : data, timestamp: new Date().toISOString() })}\n`,
    );
  serial.on('data', (data) => write('in', data));
  serial.on('error', (error) => console.error(error.message));
  process.stdin.on('data', (data) => {
    write('out', data);
    serial.write(data);
  });
  console.log(`Recording real serial traffic from ${port} to ${file}; press Ctrl+C to stop.`);
}
