import type { SerialTransportPort } from '../../domain/ports/serial-transport.js';
import type { AtCommandPort } from '../../domain/ports/at-command-port.js';

interface PendingCommand {
  command: string;
  timeout: number;
  data?: string;
  resolve: (lines: string[]) => void;
  reject: (error: Error) => void;
  lines: string[];
  sent: boolean;
  timer?: NodeJS.Timeout;
}
interface AtEngineOptions {
  onLine?: (line: string) => void;
  onUrc?: (line: string) => void;
  defaultTimeout?: number;
  urcPattern?: RegExp;
}
/** Serialized Command Queue for AT commands. The transport only needs write/isOpen. */
export class AtCommandEngine implements AtCommandPort {
  private readonly transport: Pick<SerialTransportPort, 'isOpen' | 'write'>;
  private readonly onLine: ((line: string) => void) | undefined;
  private readonly onUrc: ((line: string) => void) | undefined;
  private readonly urcPattern: RegExp;
  private buffer = '';
  private pendingUrc = '';
  private readonly defaultTimeout: number;
  private readonly queue: PendingCommand[] = [];
  private current: PendingCommand | null = null;
  constructor(
    transport: Pick<SerialTransportPort, 'isOpen' | 'write'>,
    {
      onLine,
      onUrc,
      defaultTimeout = 8000,
      urcPattern = /^(\+CMTI|\+CLIP|\+CUSD|RING|NO CARRIER|\^)/,
    }: AtEngineOptions = {},
  ) {
    this.transport = transport;
    this.onLine = onLine;
    this.onUrc = onUrc;
    this.urcPattern = urcPattern;
    this.defaultTimeout = defaultTimeout;
  }
  execute(command: string, timeout = this.defaultTimeout, data?: string): Promise<string[]> {
    if (!this.transport?.isOpen) return Promise.reject(new Error('modem not connected'));
    return new Promise((resolve, reject) => {
      this.queue.push({ command, timeout, data, resolve, reject, lines: [], sent: false });
      this.#pump();
    });
  }
  receive(chunk: string | Buffer): void {
    this.buffer += Buffer.isBuffer(chunk) ? chunk.toString('latin1') : String(chunk);
    if (this.current?.data && !this.current.sent && this.buffer.includes('> ')) {
      this.current.sent = true;
      this.buffer = '';
      this.transport.write(`${this.current.data}\x1a`);
      return;
    }
    const lines = this.buffer.split(/\r\n|\r|\n/);
    this.buffer = lines.pop() ?? '';
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      if (this.pendingUrc) {
        this.pendingUrc += `\n${line}`;
        if (this.pendingUrc.split('"').length % 2 === 1) {
          this.onUrc?.(this.pendingUrc);
          this.pendingUrc = '';
        }
        continue;
      }
      if (line.startsWith('+CUSD') && line.split('"').length % 2 === 0) {
        this.pendingUrc = line;
        continue;
      }
      if (this.urcPattern.test(line)) {
        this.onUrc?.(line);
        continue;
      }
      if (line === 'OK') this.#finish();
      else if (/ERROR/.test(line)) this.#finish(new Error(line));
      else if (this.current && line !== this.current.command) this.current.lines.push(line);
      this.onLine?.(line);
    }
  }
  disconnect(error = new Error('disconnected')): void {
    for (const command of this.queue.splice(0)) command.reject(error);
    this.#finish(error);
  }
  #pump(): void {
    if (this.current || !this.queue.length || !this.transport?.isOpen) return;
    this.current = this.queue.shift() ?? null;
    if (!this.current) return;
    this.transport.write(`${this.current.command}\r`);
    const current = this.current;
    current.timer = setTimeout(
      () => this.#finish(new Error(`timeout: ${current.command}`)),
      current.timeout,
    );
  }
  #finish(error?: Error): void {
    if (!this.current) return;
    clearTimeout(this.current.timer);
    const command = this.current;
    this.current = null;
    if (error) command.reject(error);
    else command.resolve(command.lines);
    this.#pump();
  }
}
