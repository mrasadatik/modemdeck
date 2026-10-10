import type { Command } from './modem-services.js';

export interface CarrierSnapshot {
  signalPct: number | null;
  registration: string;
  operator: string;
}

const REGISTRATION = [
  'not registered',
  'registered (home)',
  'searching',
  'denied',
  'unknown',
  'registered (roaming)',
];

/**
 * Lightweight carrier watch: three cheap commands polled on a slow cadence.
 * Returns null when the modem cannot answer (the heartbeat owns failover);
 * callers emit only on change.
 */
export class CarrierWatch {
  constructor(private readonly command: Command) {}

  async poll(): Promise<CarrierSnapshot | null> {
    try {
      const [csq, creg, cops] = await Promise.all([
        this.command('AT+CSQ', 5000).catch((): string[] => []),
        this.command('AT+CREG?', 5000).catch((): string[] => []),
        this.command('AT+COPS?', 5000).catch((): string[] => []),
      ]);
      const level = Number(csq[0]?.match(/(\d+),/)?.[1] ?? 99);
      const registration = REGISTRATION[Number(creg[0]?.match(/: \d,(\d)/)?.[1])] ?? 'n/a';
      const operator = cops[0]?.match(/\+COPS: \d,\d,"([^"]*)"/)?.[1] ?? '';
      return {
        signalPct: level === 99 ? null : Math.round((level / 31) * 100),
        registration,
        operator,
      };
    } catch {
      return null;
    }
  }
}
