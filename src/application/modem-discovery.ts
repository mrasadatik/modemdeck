import type { SerialTransportPort } from '../domain/ports/serial-transport.js';
export interface DiscoveredPort {
  path: string;
  friendlyName?: string;
  manufacturer?: string;
  vendorId?: string;
  productId?: string;
  role?: 'modem' | 'diagnostics' | 'service' | 'nmea' | 'unknown';
  score?: number;
}
export type PortLister = () => Promise<DiscoveredPort[]>;
export type PortOpener = (path: string) => Promise<SerialTransportPort>;
export class ModemDiscovery {
  constructor(
    private readonly list: PortLister,
    private readonly open: PortOpener,
    private readonly concurrency = 4,
  ) {}
  async find(): Promise<SerialTransportPort> {
    const ports = (await this.list())
      .filter((item) => item.path)
      .sort((left, right) => score(right) - score(left));
    let next = 0;
    let found: SerialTransportPort | null = null;
    const worker = async (): Promise<void> => {
      while (!found) {
        const index = next++;
        if (index >= ports.length) return;
        let candidate: SerialTransportPort | null = null;
        try {
          candidate = await this.open(ports[index].path);
          const opened = candidate;
          const result = await new Promise<boolean>((resolve) => {
            let buffer = '';
            const timer = setTimeout(() => {
              opened.removeListener('data', receive);
              resolve(false);
            }, 1200);
            const receive = (data: Buffer | string): void => {
              buffer += data.toString();
              if (/\b(?:OK|ERROR)\b/.test(buffer)) {
                clearTimeout(timer);
                opened.removeListener('data', receive);
                resolve(/\bOK\b/.test(buffer));
              }
            };
            opened.on('data', receive);
            opened.write('AT\r');
          });
          if (result && !found) found = candidate;
          else candidate.close();
        } catch {
          try {
            candidate?.close();
          } catch {
            /* cleanup best effort */
          }
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(this.concurrency, Math.max(1, ports.length)) }, () => worker()),
    );
    if (!found) throw new Error('no responding AT modem found');
    return found;
  }
}

const score = (port: DiscoveredPort): number => {
  if (typeof port.score === 'number' && Number.isFinite(port.score)) return port.score;
  if (port.role === 'modem') return 100;
  if (port.role === 'diagnostics' || port.role === 'service' || port.role === 'nmea') return -100;
  const label = `${port.friendlyName || ''} ${port.manufacturer || ''}`.toLowerCase();
  if (/\b(diagnostics?|dm service|nmea|gps|debug|service)\b/.test(label)) return -100;
  if (/\b(modem|at command|data)\b/.test(label)) return 50;
  return 0;
};
