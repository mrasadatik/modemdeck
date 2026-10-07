import type { ApiBody, ApiRoutes } from './api-router.js';
import type { ModemDatabase, UssdResult } from '../../domain/entities/types.js';
import type { LifecycleStatus } from '../../infrastructure/modem/modem-lifecycle.js';
import type { Command } from '../../application/modem-services.js';

interface ModemRouteDependencies {
  db: ModemDatabase;
  status: LifecycleStatus;
  clean: (value: unknown) => string;
  storeName: (value: unknown) => string;
  validatePhone: (value: string) => boolean;
  validateUssd: (value: string) => boolean;
  sendSms: (to: string, text: string) => Promise<number>;
  save: () => Promise<void>;
  importAll: () => Promise<number>;
  ussd: (code: string) => Promise<UssdResult>;
  network: () => Promise<Record<string, unknown>>;
  pbRead: (store: string) => Promise<Array<{ index: number; number: string; name: string }>>;
  pb: <T>(store: string, action: () => Promise<T>) => Promise<T>;
  hx: (value: unknown) => string;
  fwdGet: () => Promise<Array<{ reason: number; active: boolean; number: string }>>;
  dataState: () => Promise<Record<string, unknown>>;
  setData: (on: boolean) => Promise<Record<string, unknown>>;
  at: Command;
  config: () => Record<string, unknown>;
  updateConfig: (body: ApiBody) => Promise<Record<string, unknown>>;
  getSimId?: () => string | undefined;
}

/** HTTP route construction is kept separate from the transport and composition layers. */
export function createModemRoutes({
  db,
  status,
  clean,
  storeName,
  validatePhone,
  validateUssd,
  sendSms,
  save,
  importAll,
  ussd,
  network,
  pbRead,
  pb,
  hx,
  fwdGet,
  dataState,
  setData,
  at,
  config,
  updateConfig,
  getSimId,
}: ModemRouteDependencies): ApiRoutes {
  const text = (value: unknown, field: string): string => {
    if (typeof value !== 'string')
      throw Object.assign(new Error(`${field} must be a string`), { statusCode: 400 });
    return value;
  };
  return {
    'GET /health': async () => ({
      ok: true,
      service: 'modemdeck',
      time: new Date().toISOString(),
    }),
    'GET /ready': async () => ({
      ready: status.connected,
      modem: status.connected ? 'connected' : 'disconnected',
    }),
    'GET /api/capabilities': async () => ({ ...status.capabilities }),
    'GET /api/compatibility': async () => ({
      observed: status.capabilities,
      generatedAt: new Date().toISOString(),
      note: 'Only live probe evidence is reported.',
    }),
    'GET /api/state': async () => ({
      status,
      sms: db.sms.slice(0, 500),
      sent: db.sent.slice(0, 100),
      calls: db.calls.slice(0, 300),
      ussd: db.ussd.slice(0, 50),
    }),
    'GET /api/config': async () => config(),
    'POST /api/config': async (b: ApiBody) => updateConfig(b),
    'POST /api/sms': async (b: ApiBody) => {
      const to = clean(text(b.to, 'to'));
      const message = text(b.text, 'text');
      if (!validatePhone(to))
        throw Object.assign(new Error('invalid destination number'), { statusCode: 400 });
      if (!message || [...message].length > 2000)
        throw Object.assign(new Error('message must contain 1-2000 characters'), {
          statusCode: 400,
        });
      const n = await sendSms(to, message);
      const s = { to, text: message, ts: new Date().toISOString(), parts: n, simId: getSimId?.() };
      db.sent.unshift(s);
      await save();
      return s;
    },
    'POST /api/sms/delete': async (b: ApiBody) => {
      if (!/^[a-f0-9]{12}$/i.test(String(b.id || '')))
        throw Object.assign(new Error('invalid message id'), { statusCode: 400 });
      db.sms = db.sms.filter((x) => x.id !== b.id);
      await save();
      return { ok: 1 };
    },
    'POST /api/sync': async () => ({ imported: await importAll() }),
    'POST /api/purge': async () => {
      await importAll();
      for (const s of ['SM', 'ME']) {
        await at(`AT+CPMS="${s}","${s}","${s}"`).catch(() => {});
        await at('AT+CMGD=1,4', 20000).catch(() => {});
      }
      await at('AT+CPMS="ME","ME","ME"').catch(() => {});
      return { ok: 1 };
    },
    'POST /api/ussd': async (b: ApiBody) => {
      const code = clean(text(b.code, 'code'));
      if (!validateUssd(code))
        throw Object.assign(new Error('invalid USSD code'), { statusCode: 400 });
      const r = await ussd(code);
      db.ussd.unshift({ code, ...r, ts: new Date().toISOString(), simId: getSimId?.() });
      await save();
      return r;
    },
    'POST /api/ussd/cancel': async () => {
      await at('AT+CUSD=2');
      return { ok: 1 };
    },
    'GET /api/network': network,
    'GET /api/phonebook': async (_: ApiBody, p: URLSearchParams) =>
      pbRead(storeName(p.get('store') || 'SM')),
    'POST /api/phonebook': async (b: ApiBody) =>
      pb(storeName(b.store), async () => {
        const number = clean(b.number);
        if (!validatePhone(number))
          throw Object.assign(new Error('invalid phone number'), { statusCode: 400 });
        const name = String(b.name || '');
        if (!name || [...name].length > 80)
          throw Object.assign(new Error('invalid contact name'), { statusCode: 400 });
        const index = b.index === '' || b.index == null ? '' : Number(b.index);
        if (index !== '' && (!Number.isInteger(index) || index < 1 || index > 9999))
          throw Object.assign(new Error('invalid phonebook index'), { statusCode: 400 });
        await at(
          `AT+CPBW=${index},"${number}",${number.startsWith('+') ? 145 : 129},"${hx(name)}"`,
        );
        return { ok: 1 };
      }),
    'POST /api/phonebook/delete': async (b: ApiBody) =>
      pb(storeName(b.store), async () => {
        const index = Number(b.index);
        if (!Number.isInteger(index) || index < 1 || index > 9999)
          throw Object.assign(new Error('invalid phonebook index'), { statusCode: 400 });
        await at(`AT+CPBW=${index}`);
        return { ok: 1 };
      }),
    'GET /api/forwarding': async () => fwdGet(),
    'POST /api/forwarding': async (b: ApiBody) => {
      const reason = Number(b.reason),
        n = clean(b.number);
      if (!Number.isInteger(reason) || reason < 0 || reason > 3 || (b.on && !validatePhone(n)))
        throw Object.assign(new Error('invalid forwarding request'), { statusCode: 400 });
      await at(
        `AT+CCFC=${reason},${b.on ? 3 : 4}${b.on ? `,"${n}",${n.startsWith('+') ? 145 : 129}` : ''}`,
        30000,
      );
      return fwdGet();
    },
    'GET /api/data': dataState,
    'POST /api/data': async (b: ApiBody) => {
      if (typeof b.on !== 'boolean')
        throw Object.assign(new Error('on must be a boolean'), { statusCode: 400 });
      return { ...(await setData(b.on)), ...(await dataState()) };
    },
    'POST /api/apn': async (b: ApiBody) => {
      const apn = clean(b.apn);
      if (!/^[A-Za-z0-9._-]{1,100}$/.test(apn))
        throw Object.assign(new Error('invalid APN'), { statusCode: 400 });
      await at(`AT+CGDCONT=1,"IP","${apn}"`);
      return { ok: 1 };
    },
    'POST /api/at': async (b: ApiBody) => {
      const command = String(b.cmd || '')
        .trim()
        .replace(/[\r\n]/g, '');
      if (
        !/^AT(?:\+[A-Z0-9]+(?:\?|=[^;]{0,120})?)?$/i.test(command) ||
        /^(?:AT(?:D|A|H|T|O|\+CMGS|\+CMSS))/i.test(command)
      ) {
        throw Object.assign(new Error('command is not permitted'), { statusCode: 400 });
      }
      return { lines: await at(command, 30000) };
    },
  };
}
