import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { SerialPort } from 'serialport';
import { createApp } from './app.js';
import { createModemRoutes } from '../interfaces/http/modem-routes.js';
import { HttpServerAdapter } from '../interfaces/http/http-server-adapter.js';
import { SseHub } from '../interfaces/http/sse-hub.js';
import { ModemLifecycle } from '../infrastructure/modem/modem-lifecycle.js';
import {
  SmsIngestionService,
  UssdSessionManager,
  NetworkService,
  PhonebookService,
  ForwardingService,
  DialupAdapter,
} from '../application/modem-services.js';
import { validatePhone, validateUssd } from '../domain/services/protocol.js';
import type { UssdResult } from '../domain/entities/types.js';
import { createProfileRegistry } from '../infrastructure/modem/profiles.js';
import { simScopedState } from '../application/sim-visibility.js';
import { createAuthRoutes } from '../interfaces/http/auth-routes.js';
import { sessionKeyOrNull, lockSession } from './session.js';
import { discoverMatchingRasProfiles } from '../infrastructure/windows/ras-profile-discovery.js';
import { listWindowsModems } from '../infrastructure/windows/modem-provider.js';
import { discoverWindowsDataTransports } from '../infrastructure/windows/data-transport-discovery.js';
import { DataTransportSelector } from '../application/data-transport-selector.js';
import { saveConfig, validateConfig } from '../infrastructure/config/config.js';

const composition = createApp({ rootDir: process.cwd() });
const { config, repository, interaction } = composition;
const db = repository.state;
const sse = new SseHub();
const emit = (event: string, value: unknown): void => sse.publish(event, value);
let activeSimId = '';
const syncSimIdentity = async (): Promise<void> => {
  if (!status.connected) {
    activeSimId = '';
    return;
  }
  try {
    const imsi = clean((await command('AT+CIMI', 5000).catch(() => [] as string[]))[0]);
    activeSimId = imsi
      ? createHash('sha256').update(`modemdeck:${imsi}`).digest('hex').slice(0, 16)
      : '';
  } catch {
    activeSimId = '';
  }
  try {
    const credsFile = `${process.cwd()}/data/credentials.json`;
    if (activeSimId && fs.existsSync(credsFile)) {
      const stored = JSON.parse(fs.readFileSync(credsFile, 'utf8')) as { simId?: string };
      if (stored.simId && stored.simId !== activeSimId && sessionKeyOrNull()) {
        lockSession();
        repository.lock?.();
        activeSimId = '';
        status.error = 'SIM changed — unlock required';
        emit('status', status);
      }
    }
  } catch {
    /* best-effort hot-swap check */
  }
};
const status = {
  connected: false,
  port: '',
  error: '',
  capabilities: {
    sms: false,
    ussd: false,
    phonebook: false,
    forwarding: false,
    network: false,
    data: Boolean(config.dialup),
  },
};
const command = (value: string, timeout = 8000, data?: string): Promise<string[]> =>
  lifecycle.command(value, timeout, data);
const audit = interaction.child('runtime');
const sms = new SmsIngestionService(db, repository, emit, () => activeSimId);
const ussd = new UssdSessionManager(command);
const network = new NetworkService(command);
const phonebook = new PhonebookService(command);
const forwarding = new ForwardingService(command);
const run = (file: string, args: string[]): Promise<{ ok: boolean; out: string }> =>
  new Promise((resolve) =>
    execFile(file, args, { windowsHide: true }, (error, stdout, stderr) =>
      resolve({ ok: !error, out: String(stdout || stderr || error?.message || '') }),
    ),
  );
const dialup = new DialupAdapter(config.dialup, run, async () => {
  const modems = await listWindowsModems(run);
  return discoverMatchingRasProfiles({
    modemNames: modems.filter((item) => item.status === 'OK').map((item) => item.name),
  });
});
const dataTransports = new DataTransportSelector(() => discoverWindowsDataTransports(run));
const dataState = async (): Promise<Record<string, unknown>> => {
  const candidates = await dataTransports.all();
  return { ...(await dialup.state()), selected: candidates[0], candidates };
};
const clean = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/[\r\n"]/g, '').trim() : '';
const storeName = (value: unknown): string => {
  const name = typeof value === 'string' ? value.trim() : 'SM';
  if (!/^[A-Za-z0-9_]{1,8}$/.test(name))
    throw Object.assign(new Error('invalid phonebook store'), { statusCode: 400 });
  return name;
};
const encodeName = (value: unknown): string =>
  Buffer.from(typeof value === 'string' ? value : '', 'utf16le')
    .swap16()
    .toString('hex')
    .toUpperCase();
const urc = async (line: string): Promise<void> => {
  if (line.startsWith('+CUSD')) {
    ussd.receive(line);
    return;
  }
  if (line.startsWith('+CMTI')) {
    const match = line.match(/"(\w+)",(\d+)/);
    if (match) {
      await command(`AT+CPMS="${match[1]}"`);
      const lines = await command(`AT+CMGR=${match[2]}`);
      const pdu = lines.find((value) => /^[0-9A-F]{20,}$/i.test(value));
      if (pdu) sms.ingest(pdu);
    }
    return;
  }
  if (line.startsWith('+CLIP')) {
    const number = line.match(/"([^"]*)"/)?.[1] || 'Unknown';
    const call = { number, ts: new Date().toISOString(), simId: activeSimId || undefined };
    db.calls.unshift(call);
    await repository.save();
    emit('call', call);
  }
};
const publicConfig = (): Record<string, unknown> => ({
  port: config.port,
  http: config.http,
  dialup: config.dialup,
  baud: config.baud,
  profile: config.profile,
  captureRaw: config.captureRaw,
  capturePath: config.capturePath,
  retentionDays: config.retentionDays,
  persistSensitive: config.persistSensitive,
  logPayloads: config.logPayloads,
  authConfigured: Boolean(config.authToken),
  restartOnly: [
    'http',
    'authToken',
    'dataPath',
    'retentionDays',
    'persistSensitive',
    'logPayloads',
  ],
});
const lifecycle = new ModemLifecycle(
  config.port,
  config.baud,
  status,
  urc,
  async () => {
    await sms.import(command);
  },
  { enabled: config.captureRaw === true, path: config.capturePath || 'data/traces/live.ndjson' },
  createProfileRegistry().select({ profileId: config.profile }),
  audit.record,
  async () => listWindowsModems(run),
  () => {
    void syncSimIdentity();
    emit('status', status);
  },
);
const routes = createModemRoutes({
  db,
  status,
  clean,
  storeName,
  validatePhone,
  validateUssd,
  sendSms: (to: string, text: string) => lifecycle.sendSms(to, text),
  save: repository.save,
  importAll: () => sms.import(command),
  ussd: (code: string): Promise<UssdResult> => ussd.start(code),
  network: () => network.read(),
  pbRead: (store: string) => phonebook.read(store),
  pb: <T>(store: string, action: () => Promise<T>) => phonebook.withStore(store, action),
  hx: encodeName,
  fwdGet: () => forwarding.read(),
  dataState,
  setData: (on: boolean) => dialup.set(on),
  at: async (value: string, timeout?: number, data?: string) => {
    audit.record('command', value, data, /CMGS|CUSD|CPBW|CCFC/i.test(value));
    try {
      const result = await command(value, timeout, data);
      audit.record('response', value, result);
      return result;
    } catch (error) {
      audit.record('error', value, error instanceof Error ? error.message : String(error));
      throw error;
    }
  },
  config: publicConfig,
  getSimId: () => activeSimId || undefined,
  updateConfig: async (body) => {
    const next = { ...config };
    const editable = ['port', 'baud', 'dialup', 'profile', 'captureRaw', 'capturePath'] as const;
    for (const key of editable) {
      const value = body[key];
      if (value === undefined) continue;
      const valid =
        key === 'baud'
          ? typeof value === 'number' && Number.isInteger(value)
          : key === 'captureRaw'
            ? typeof value === 'boolean'
            : typeof value === 'string';
      if (!valid) throw Object.assign(new Error(`${key} has an invalid type`), { statusCode: 400 });
      (next[key] as never) = value as never;
    }
    validateConfig(next);
    const modemChanged =
      next.port !== config.port ||
      next.baud !== config.baud ||
      next.profile !== config.profile ||
      next.captureRaw !== config.captureRaw ||
      next.capturePath !== config.capturePath;
    Object.assign(config, next);
    saveConfig(process.cwd(), config);
    dialup.setName(config.dialup);
    if (modemChanged)
      await lifecycle.reconfigure(
        config.port,
        config.baud,
        createProfileRegistry().select({ profileId: config.profile }),
        {
          enabled: config.captureRaw === true,
          path: config.capturePath || 'data/traces/live.ndjson',
        },
      );
    return { ...publicConfig(), applied: true, hotReloaded: modemChanged, restartRequired: false };
  },
});
routes['GET /health'] = async () => ({
  ok: true,
  service: 'modemdeck',
  time: new Date().toISOString(),
});
routes['GET /ready'] = async () => ({
  ready: status.connected,
  modem: status.connected ? 'connected' : 'disconnected',
});
routes['GET /api/state'] = async () =>
  sessionKeyOrNull()
    ? simScopedState(db, status, activeSimId)
    : { status, sms: [], sent: [], calls: [], ussd: [] };
const auth = createAuthRoutes({
  rootDir: process.cwd(),
  repository,
  activeSimId: () => activeSimId,
  sendSms: (to, text) => lifecycle.sendSms(to, text),
});
Object.assign(routes, auth);
routes['GET /api/ports'] = async () => {
  const [listed, modems] = await Promise.all([SerialPort.list(), listWindowsModems(run)]);
  const ports = new Map<string, { path: string; label: string }>();
  for (const item of listed)
    ports.set(item.path, {
      path: item.path,
      label: (item as typeof item & { friendlyName?: string }).friendlyName || item.path,
    });
  for (const modem of modems)
    if (modem.status === 'OK' && modem.attachedTo)
      ports.set(modem.attachedTo, { path: modem.attachedTo, label: modem.name });
  return [...ports.values()];
};
routes['GET /api/capabilities'] = async () => ({ ...status.capabilities });
routes['GET /api/compatibility'] = async () => ({
  profile: config.profile || 'generic-standards',
  observed: status.capabilities,
  generatedAt: new Date().toISOString(),
  note: 'Only live probe evidence is reported; unavailable hardware is not inferred.',
});
const allowedUnauthenticated = new Set([
  'GET /health',
  'GET /ready',
  'GET /api/state',
  ...Object.keys(auth),
]);
for (const [key, handler] of Object.entries(routes)) {
  if (!allowedUnauthenticated.has(key)) {
    const protectedHandler = handler;
    routes[key] = async (body, params) => {
      if (!sessionKeyOrNull())
        throw Object.assign(new Error('profile is locked — unlock first'), { statusCode: 423 });
      return protectedHandler(body, params);
    };
  }
}
const server = new HttpServerAdapter({
  port: config.http,
  rootDir: process.cwd(),
  token: config.authToken,
  routes,
  sse,
});
async function start(): Promise<void> {
  await server.start();
  await lifecycle.start();
}
async function stop(): Promise<void> {
  await lifecycle.stop();
  await server.stop();
  interaction.close();
  repository.close?.();
}
void start();
process.once('SIGINT', () => {
  void stop();
});
process.once('SIGTERM', () => {
  void stop();
});
