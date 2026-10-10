import { SerialPort } from 'serialport';
import { withTimeout } from '../infrastructure/async.js';
const port = process.env.MODEMDECK_PORT || process.argv[2] || '';
const ports = await withTimeout(SerialPort.list(), 8000, 'serial listing timed out').catch(
  (): Awaited<ReturnType<typeof SerialPort.list>> => {
    console.error('SKIP: serial listing hung; no hardware behavior was tested.');
    process.exitCode = 2;
    return [];
  },
);
if (!port && ports.length === 0) {
  console.error('SKIP: no serial ports are present; no hardware behavior was tested.');
  process.exitCode = 2;
} else if (!port) {
  console.error(
    `SKIP: no modem port selected (available ports: ${ports.map((item) => item.path).join(', ')}).`,
  );
  process.exitCode = 2;
} else {
  let serial: SerialPort | undefined;
  try {
    serial = new SerialPort({
      path: port,
      baudRate: Number(process.env.MODEMDECK_BAUD || 115200),
      autoOpen: false,
    });
    const opened = serial;
    await new Promise<void>((resolve, reject) =>
      opened.open((error) => (error ? reject(error) : resolve())),
    );
    const response = await new Promise<boolean>((resolve, reject) => {
      let buffer = '';
      const timer = setTimeout(() => {
        opened.removeListener('data', receive);
        resolve(false);
      }, 2000);
      const receive = (data: Buffer): void => {
        buffer += data.toString();
        if (/\b(?:OK|ERROR)\b/.test(buffer)) {
          clearTimeout(timer);
          opened.removeListener('data', receive);
          resolve(/\bOK\b/.test(buffer));
        }
      };
      opened.on('data', receive);
      opened.write('AT\r', (error) => {
        if (error) {
          clearTimeout(timer);
          opened.removeListener('data', receive);
          reject(error);
        }
      });
    });
    if (!response) throw new Error('port did not return an AT OK response within 2000ms');
    console.log(
      `PASS: hardware port ${port} returned AT OK; this is the only live check performed.`,
    );
  } catch (error) {
    console.error(
      `FAIL: live hardware test could not verify ${port}: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  } finally {
    if (serial?.isOpen) await new Promise<void>((resolve) => serial?.close(() => resolve()));
  }
}
