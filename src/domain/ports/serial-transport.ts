/** Minimal serial contract; the domain never depends on serialport. */
export interface SerialTransportPort {
  readonly path?: string;
  readonly isOpen: boolean;
  write(data: string | Uint8Array): void;
  on(event: string, listener: (...args: never[]) => void): this;
  removeListener(event: string, listener: (...args: never[]) => void): this;
  removeAllListeners(): void;
  close(): void;
}
