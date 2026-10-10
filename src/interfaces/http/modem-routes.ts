import type { ApiBody, ApiRoutes } from './api-router.js';
import type { ModemDatabase, UssdResult } from '../../domain/entities/types.js';
import type { LifecycleStatus } from '../../infrastructure/modem/modem-lifecycle.js';
import type { Command } from '../../application/modem-services.js';
import {
  apnName,
  atCommand,
  contactName,
  dataToggle,
  forwardingReason,
  messageId,
  parseField,
  phoneE164,
  phonebookIndex,
  phonebookStore,
  smsText,
  ussdCode,
} from '../../domain/validation/schemas.js';

interface ModemRouteDependencies {
  db: ModemDatabase;
  status: LifecycleStatus;
  clean: (value: unknown) => string;
  phoneCountry: () => string | undefined;
  sendSms: (to: string, text: string) => Promise<number>;
  save: () => Promise<void>;
  importAll: () => Promise<{ imported: number; perStore: Record<string, number> }>;
  purgeAll: () => Promise<Record<string, boolean>>;
  ussd: (code: string) => Promise<UssdResult>;
  network: () => Promise<Record<string, unknown>>;
  pbRead: (store: string) => Promise<Array<{ index: number; number: string; name: string }>>;
  pbStores: () => Promise<string[]>;
  pb: <T>(store: string, action: () => Promise<T>) => Promise<T>;
  hx: (value: unknown) => string;
  fwdGet: () => Promise<Array<{ reason: number; active: boolean; number: string; error?: string }>>;
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
  phoneCountry,
  sendSms,
  save,
  importAll,
  purgeAll,
  ussd,
  network,
  pbRead,
  pbStores,
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
  /** Strictly validate then canonicalize to E.164; throws 400 otherwise. */
  const e164 = (raw: unknown, message: string): string =>
    parseField(phoneE164(phoneCountry(), message), raw);
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
      const to = e164(clean(text(b.to, 'to')), 'invalid destination number');
      const message = parseField(smsText(), text(b.text, 'text'));
      const n = await sendSms(to, message);
      const s = { to, text: message, ts: new Date().toISOString(), parts: n, simId: getSimId?.() };
      db.sent.unshift(s);
      await save();
      return s;
    },
    'POST /api/sms/delete': async (b: ApiBody) => {
      parseField(messageId(), b.id);
      db.sms = db.sms.filter((x) => x.id !== b.id);
      await save();
      return { ok: 1 };
    },
    'POST /api/sync': async () => {
      const result = await importAll();
      return { imported: result.imported, perStore: result.perStore };
    },
    'POST /api/purge': async () => {
      const result = await importAll();
      const cleared = await purgeAll();
      return { ok: 1, imported: result.imported, perStore: result.perStore, cleared };
    },
    'POST /api/ussd': async (b: ApiBody) => {
      const code = parseField(ussdCode(), clean(text(b.code, 'code')));
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
    'GET /api/phonebook/stores': async () => ({ stores: await pbStores() }),
    'GET /api/phonebook': async (_: ApiBody, p?: URLSearchParams) => {
      const simEntries = await pbRead(parseField(phonebookStore(), p?.get('store') || 'SM'));
      const app = getSimId?.() ? db.contacts.filter((c) => c.simId === getSimId()) : db.contacts;
      return [
        ...simEntries.map((c) => ({ ...c, source: 'sim' }) as const),
        ...app.map(
          (c) => ({ index: c.index, number: c.number, name: c.name, source: 'app' }) as const,
        ),
      ];
    },
    'POST /api/phonebook': async (b: ApiBody) => {
      if (b.dest === 'app') {
        const number = e164(clean(b.number), 'invalid phone number');
        const name = parseField(contactName(), b.name);
        const next = db.contacts.length ? Math.max(...db.contacts.map((c) => c.index)) + 1 : 1;
        db.contacts.unshift({
          index: b.index ? Number(b.index) : next,
          name,
          number,
          simId: getSimId?.(),
        });
        await save();
        return { ok: 1, source: 'app' };
      }
      return pb(parseField(phonebookStore(), b.store), async () => {
        const number = e164(clean(b.number), 'invalid phone number');
        const name = parseField(contactName(), b.name);
        const index = parseField(phonebookIndex(), b.index);
        await at(
          `AT+CPBW=${index},"${number}",${number.startsWith('+') ? 145 : 129},"${hx(name)}"`,
        );
        return { ok: 1 };
      });
    },
    'POST /api/phonebook/delete': async (b: ApiBody) => {
      if (b.dest === 'app') {
        const index = Number(b.index);
        db.contacts = db.contacts.filter((c) => c.index !== index);
        await save();
        return { ok: 1 };
      }
      return pb(parseField(phonebookStore(), b.store), async () => {
        const index = parseField(phonebookIndex(), b.index);
        if (index === '')
          throw Object.assign(new Error('invalid phonebook index'), { statusCode: 400 });
        await at(`AT+CPBW=${index}`);
        return { ok: 1 };
      });
    },
    'GET /api/forwarding': async () => fwdGet(),
    'POST /api/forwarding': async (b: ApiBody) => {
      const reason = parseField(forwardingReason(), b.reason);
      const n = b.on ? e164(clean(b.number), 'invalid forwarding request') : '';
      await at(
        `AT+CCFC=${reason},${b.on ? 3 : 4}${b.on ? `,"${n}",${n.startsWith('+') ? 145 : 129}` : ''}`,
        30000,
      );
      return fwdGet();
    },
    'GET /api/data': dataState,
    'POST /api/data': async (b: ApiBody) => {
      const on = parseField(dataToggle(), b.on);
      return { ...(await setData(on)), ...(await dataState()) };
    },
    'POST /api/apn': async (b: ApiBody) => {
      const apn = parseField(apnName(), clean(b.apn));
      await at(`AT+CGDCONT=1,"IP","${apn}"`);
      return { ok: 1 };
    },
    'POST /api/at': async (b: ApiBody) => {
      const command = parseField(atCommand(), b.cmd);
      return { lines: await at(command, 30000) };
    },
  };
}
