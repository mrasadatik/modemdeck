import { SerialPort } from 'serialport';
import type { SerialTransportPort } from '../../domain/ports/serial-transport.js';

/** Adapter around serialport, keeping hardware construction out of the domain.
 * serialport's event overloads are broader than the domain interface, so this
 * adapter is the single documented third-party typing boundary. */
export class SerialTransport implements SerialTransportPort {
  constructor(private readonly port: SerialPort) {}
  get path(): string {
    return this.port.path;
  }
  get isOpen(): boolean {
    return this.port.isOpen;
  }
  write(data: string | Buffer): void {
    this.port.write(data);
  }
  on(event: string, listener: (...args: never[]) => void): this {
    this.port.on(event, listener as Parameters<SerialPort['on']>[1]);
    return this;
  }
  removeListener(event: string, listener: (...args: never[]) => void): this {
    this.port.removeListener(event, listener as Parameters<SerialPort['removeListener']>[1]);
    return this;
  }
  close(): void {
    this.port.close();
  }
  removeAllListeners(): void {
    this.port.removeAllListeners();
  }
}

export function createSerialTransport(path: string, baudRate: number): Promise<SerialTransport> {
  return new Promise((resolve, reject) => {
    const port = new SerialPort({ path, baudRate, autoOpen: false });
    port.open((error: Error | null) =>
      error ? reject(error) : resolve(new SerialTransport(port)),
    );
  });
}
