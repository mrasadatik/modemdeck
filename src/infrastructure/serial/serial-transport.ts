import { SerialPort } from 'serialport';
import type { SerialTransportPort } from '../../domain/ports/serial-transport.js';

type ErrorListener = (error: Error) => void;

/** Adapter around serialport, keeping hardware construction out of the domain.
 * serialport's event overloads are broader than the domain interface, so this
 * adapter is the single documented third-party typing boundary.
 *
 * Reliability: a raw SerialPort with zero 'error' listeners throws on the
 * process (e.g. "WriteFileEx: Invalid handle" when a USB modem resets or
 * Windows reclaims the handle). This adapter therefore holds one permanent
 * internal 'error' subscription and redispatches to 'error' subscribers, so
 * there is never a window — discovery handoff, reconnect backoff, teardown —
 * where a port error can crash the server. With no subscribers the error is
 * swallowed; callers that care (discovery probe, lifecycle) always subscribe.
 */
export class SerialTransport implements SerialTransportPort {
  private readonly errorHandlers = new Set<ErrorListener>();
  constructor(private readonly port: SerialPort) {
    this.port.on('error', (error: Error) => this.dispatch(error));
  }
  get path(): string {
    return this.port.path;
  }
  get isOpen(): boolean {
    return this.port.isOpen;
  }
  write(data: string | Buffer): void {
    try {
      this.port.write(data, (error: Error | null | undefined) => {
        if (error) this.dispatch(error instanceof Error ? error : new Error(String(error)));
      });
    } catch (error) {
      this.dispatch(error instanceof Error ? error : new Error(String(error)));
    }
  }
  on(event: string, listener: (...args: never[]) => void): this {
    if (event === 'error') this.errorHandlers.add(listener as unknown as ErrorListener);
    else this.port.on(event, listener as Parameters<SerialPort['on']>[1]);
    return this;
  }
  removeListener(event: string, listener: (...args: never[]) => void): this {
    if (event === 'error') this.errorHandlers.delete(listener as unknown as ErrorListener);
    else this.port.removeListener(event, listener as Parameters<SerialPort['removeListener']>[1]);
    return this;
  }
  close(): void {
    try {
      this.port.close((error: Error | null | undefined) => {
        if (error) this.dispatch(error instanceof Error ? error : new Error(String(error)));
      });
    } catch (error) {
      this.dispatch(error instanceof Error ? error : new Error(String(error)));
    }
  }
  removeAllListeners(): void {
    this.errorHandlers.clear();
    this.port.removeAllListeners();
    // removeAllListeners() above also drops the permanent guard — restore it
    // so a later port error can never become an unhandled 'error' event.
    this.port.on('error', (error: Error) => this.dispatch(error));
  }
  private dispatch(error: Error): void {
    for (const handler of [...this.errorHandlers]) {
      try {
        handler(error);
      } catch {
        /* subscriber bugs must not break dispatch */
      }
    }
  }
}

export function createSerialTransport(path: string, baudRate: number): Promise<SerialTransport> {
  return new Promise((resolve, reject) => {
    const port = new SerialPort({ path, baudRate, autoOpen: false });
    // Cover the open window: until SerialTransport attaches its permanent
    // handler, an early port error would otherwise be unhandled and crash.
    const earlySwallow = ((): ((error: Error) => void) => {
      const handler = (): void => undefined;
      port.on('error', handler);
      return handler;
    })();
    let settled = false;
    // A wedged handle may never invoke the open callback; bound it so
    // discovery can move on instead of hanging forever.
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      port.removeListener('error', earlySwallow);
      try {
        port.close(() => undefined);
      } catch {
        /* best effort */
      }
      reject(new Error(`timed out opening ${path}`));
    }, 10_000);
    port.open((error: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      port.removeListener('error', earlySwallow);
      if (error) {
        try {
          port.close(() => undefined);
        } catch {
          /* best effort */
        }
        reject(error);
        return;
      }
      resolve(new SerialTransport(port));
    });
  });
}
