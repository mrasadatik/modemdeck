import { createHash } from 'node:crypto';
import { decodePdu } from '../domain/services/sms-codec.js';
import type { ModemDatabase, UssdResult } from '../domain/entities/types.js';
import type { Repository } from '../domain/ports/repository.js';

export type Publish = (event: string, data: unknown) => void;
export type Command = (command: string, timeout?: number, data?: string) => Promise<string[]>;
const error = (message: string, statusCode = 400): Error & { statusCode: number } =>
  Object.assign(new Error(message), { statusCode });

export class SmsIngestionService {
  constructor(
    private readonly db: ModemDatabase,
    private readonly repository: Repository<ModemDatabase>,
    private readonly publish: Publish,
  ) {}
  ingest(hex: string): boolean {
    const id = createHash('sha1').update(hex).digest('hex');
    if (this.db.seen[id]) return false;
    const message = decodePdu(hex);
    if (!message) return false;
    this.db.seen[id] = 1;
    const keys = Object.keys(this.db.seen);
    if (keys.length > 10000)
      for (const key of keys.slice(0, keys.length - 10000)) delete this.db.seen[key];
    if (message.total > 1) {
      const key = `${message.from}|${message.ref}`;
      const parts = this.db.parts[key] ?? (this.db.parts[key] = {});
      parts[message.seq] = message.text;
      if (Object.keys(parts).length < message.total) {
        void this.repository.save();
        return false;
      }
      message.text = Array.from(
        { length: message.total },
        (_, index) => parts[index + 1] ?? '',
      ).join('');
      delete this.db.parts[key];
    }
    const sms = { id: id.slice(0, 12), from: message.from, ts: message.ts, text: message.text };
    this.db.sms.unshift(sms);
    this.db.sms.sort((a, b) => b.ts.localeCompare(a.ts));
    void this.repository.save();
    this.publish('sms', sms);
    return true;
  }
  async import(command: Command): Promise<number> {
    let count = 0;
    for (const store of ['SM', 'ME']) {
      try {
        await command(`AT+CPMS="${store}"`);
        const lines = await command('AT+CMGL=4', 30000);
        for (let index = 0; index < lines.length; index++)
          if (
            lines[index]?.startsWith('+CMGL:') &&
            lines[index + 1] &&
            this.ingest(lines[index + 1])
          )
            count++;
      } catch {
        /* optional storage is modem-specific */
      }
    }
    await command('AT+CPMS="ME","ME","ME"').catch((): undefined => undefined);
    return count;
  }
}

export class UssdSessionManager {
  private pending: {
    resolve: (value: UssdResult) => void;
    reject: (reason: Error) => void;
    timer: NodeJS.Timeout;
  } | null = null;
  constructor(private readonly command: Command) {}
  async start(code: string): Promise<UssdResult> {
    if (this.pending) throw error('another USSD session is active', 409);
    return new Promise<UssdResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null;
        reject(new Error('USSD timeout'));
      }, 45000);
      this.pending = { resolve, reject, timer };
      this.command(`AT+CUSD=1,"${code.replace(/[\r\n"]/g, '')}",15`).catch(
        (reason: unknown): void =>
          this.finishError(reason instanceof Error ? reason : new Error(String(reason))),
      );
    });
  }
  receive(line: string): void {
    const match = line.match(/\+CUSD:\s*(\d)(?:,"([\s\S]*)",(\d+))?/);
    if (!match || !this.pending) return;
    let text = match[2] ?? '';
    const dcs = Number(match[3]);
    text = decodeUssdText(text, dcs);
    const result = { text, more: match[1] === '1', status: Number(match[1]) };
    clearTimeout(this.pending.timer);
    this.pending.resolve(result);
    this.pending = null;
  }

  cancel(): void {
    void this.command('AT+CUSD=2');
    this.finishError(new Error('USSD cancelled'));
  }
  private finishError(reason: Error): void {
    if (!this.pending) return;
    clearTimeout(this.pending.timer);
    this.pending.reject(reason);
    this.pending = null;
  }
}

/** Decode the DCS forms seen in real +CUSD URCs without assuming one vendor encoding. */
export function decodeUssdText(value: string, dcs: number): string {
  if (![8, 72, 0x48, 0xf8].includes(dcs) || !/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0)
    return value;
  const bytes = Buffer.from(value, 'hex');
  if (bytes.length % 2 === 0) return bytes.swap16().toString('utf16le').replace(/\0+$/, '');
  return bytes.toString('latin1');
}

export class NetworkService {
  constructor(private readonly command: Command) {}
  async read(): Promise<Record<string, unknown>> {
    const output: Record<string, string[]> = {};
    for (const code of [
      'CSQ',
      'COPS?',
      'CREG?',
      'CGREG?',
      'CEREG?',
      'CPIN?',
      'CGSN',
      'CGMR',
      'CGDCONT?',
    ])
      output[code] = await this.command(`AT+${code}`).catch((reason) => [
        reason instanceof Error ? reason.message : String(reason),
      ]);
    const csq = Number(output.CSQ?.[0]?.match(/(\d+),/)?.[1] ?? 99);
    const operator = output['COPS?']?.[0]?.match(/\+COPS: \d,\d,"([^"]*)",(\d+)/);
    const registration = (key: string): string => {
      const value = output[key]?.[0]?.match(/: \d,(\d)/)?.[1];
      return (
        [
          'not registered',
          'registered (home)',
          'searching',
          'denied',
          'unknown',
          'registered (roaming)',
        ][Number(value)] ?? 'n/a'
      );
    };
    return {
      signal: csq === 99 ? null : { csq, dbm: -113 + 2 * csq, pct: Math.round((csq / 31) * 100) },
      operator: operator?.[1],
      tech: operator?.[2],
      cs: registration('CREG?'),
      ps: registration('CGREG?'),
      eps: registration('CEREG?'),
      sim: output.CPIN?.[0],
      imei: output.CGSN?.[0],
      firmware: output.CGMR?.[0],
      apn: output['CGDCONT?'],
    };
  }
}

export class PhonebookService {
  constructor(private readonly command: Command) {}
  async withStore<T>(store: string, action: () => Promise<T>): Promise<T> {
    if (!/^[A-Za-z0-9_]{1,8}$/.test(store)) throw error('invalid phonebook store');
    await this.command(`AT+CPBS="${store}"`);
    await this.command('AT+CSCS="UCS2"');
    try {
      return await action();
    } finally {
      await this.command('AT+CSCS="IRA"').catch((): undefined => undefined);
    }
  }
  async read(store: string): Promise<Array<{ index: number; number: string; name: string }>> {
    return this.withStore(store, async () => {
      const range = (await this.command('AT+CPBR=?'))[0]?.match(/\((\d+)-(\d+)\)/);
      const lines = await this.command(
        `AT+CPBR=${range?.[1] || 1},${range?.[2] || 250}`,
        30000,
      ).catch((): string[] => []);
      return lines.flatMap((line) => {
        const match = line.match(/\+CPBR: (\d+),"([^"]*)",(\d+),"([^"]*)"/);
        return match
          ? [
              {
                index: Number(match[1]),
                number: match[2],
                name: Buffer.from(match[4], 'hex').swap16().toString('utf16le'),
              },
            ]
          : [];
      });
    });
  }
}

export class ForwardingService {
  constructor(private readonly command: Command) {}
  async read(): Promise<Array<{ reason: number; active: boolean; number: string }>> {
    const result = [];
    for (const reason of [0, 1, 2, 3]) {
      const lines = await this.command(`AT+CCFC=${reason},2`, 20000).catch((): string[] => []);
      const match = lines
        .map((line) => line.match(/\+CCFC: (\d),(\d+)(?:,"([^"]*)")?/))
        .find((item) => item?.[1] === '1' && Number(item[2]) & 1);
      result.push({ reason, active: Boolean(match), number: match?.[3] || '' });
    }
    return result;
  }
}

export class DialupAdapter {
  constructor(
    private name: string,
    private readonly run: (file: string, args: string[]) => Promise<{ ok: boolean; out: string }>,
    private readonly discover?: () => Promise<string[]>,
  ) {}
  setName(name: string): void {
    this.name = name;
  }
  async profile(): Promise<{
    configured: boolean;
    name?: string;
    source: 'configured' | 'discovered' | 'none';
  }> {
    if (this.name) return { configured: true, name: this.name, source: 'configured' };
    const matches = [...new Set(await (this.discover?.() ?? Promise.resolve([])))];
    if (matches.length > 1)
      throw new Error(`multiple matching dial-up profiles found: ${matches.join(', ')}`);
    return matches.length === 1
      ? { configured: true, name: matches[0], source: 'discovered' }
      : { configured: false, source: 'none' };
  }
  async state(): Promise<{ configured: boolean; on: boolean; name?: string }> {
    const profile = await this.profile();
    if (!profile.name) return { configured: false, on: false };
    const result = await this.run('rasdial', []);
    return {
      configured: true,
      name: profile.name,
      on: new RegExp(`^Connected to\\s+${escapeRegExp(profile.name)}\\s*$`, 'mi').test(result.out),
    };
  }
  async set(on: boolean): Promise<{ configured: boolean; on: boolean; name?: string }> {
    const profile = await this.profile();
    if (!profile.name) throw new Error('no matching Windows dial-up profile was found');
    const current = await this.state();
    if (current.on === on) return current;
    const result = await this.run('rasdial', on ? [profile.name] : [profile.name, '/DISCONNECT']);
    if (!result.ok) throw new Error(result.out.trim());
    return this.state();
  }
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
