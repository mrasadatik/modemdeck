import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
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
  selectMessageStore,
} from '../application/modem-services.js';
import { getDefaultCountry } from '../interfaces/http/auth-routes.js';
import type { UssdResult } from '../domain/entities/types.js';
import { createProfileRegistry } from '../infrastructure/modem/profiles.js';
import { simScopedState } from '../application/sim-visibility.js';
import { createAuthRoutes } from '../interfaces/http/auth-routes.js';
import { sessionKeyOrNull, lockSession } from './session.js';
import { SessionManager } from '../infrastructure/auth/session-store.js';
import { osUnprotect } from '../infrastructure/crypto/vault.js';
import { createDefaultProvider } from '../infrastructure/platform/registry.js';
import { DataTransportSelector } from '../application/data-transport-selector.js';
import { portChange } from '../application/modem-discovery.js';
import { CarrierWatch } from '../application/carrier-watch.js';
import { saveConfig, validateConfig } from '../infrastructure/config/config.js';
import { withTimeout } from '../infrastructure/async.js';
import {
  configFlag,
  configInt,
  configString,
  lockMinutes,
  parseField,
  sessionMaxMinutes,
} from '../domain/validation/schemas.js';

const composition = createApp({ rootDir: process.cwd() });
const { config, repository, interaction } = composition;
const db = repository.state;
const sse = new SseHub();
const emit = (event: string, value: unknown): void => sse.publish(event, value);
// Session registry shares the SQLite file with records and interaction logs.
const sessions = new SessionManager(
  config.dataPath || path.join(process.cwd(), 'data', 'modemdeck.sqlite'),
);
const sessionLimits = (): { idleMs: number; maxAgeMs: number } => ({
  idleMs: (Number(config.lockMinutes) || 0) * 60_000,
  maxAgeMs: (Number(config.sessionMaxMinutes) || 0) * 60_000,
});
/** A request is authenticated only with the data key and a live session. */
const validSession = (id: string | undefined): boolean => {
  if (!sessionKeyOrNull() || !id) return false;
  const checked = sessions.validate(
    id,
    activeSimId ? { simId: activeSimId, limits: sessionLimits() } : { limits: sessionLimits() },
  );
  if (!checked.ok) return false;
  sessions.touch(id);
  return true;
};
/** Wipe decrypted state once the last live session is gone. */
const lockIfIdle = (): void => {
  if (sessions.live().length === 0 && sessionKeyOrNull()) {
    lockSession();
    repository.lock?.();
  }
};
let activeSimId = '';
let lastPort = '';
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
      const stored = JSON.parse(fs.readFileSync(credsFile, 'utf8')) as {
        simId?: string;
        osVersion?: number;
        simId_os?: string;
      };
      const storedSimId =
        stored.osVersion === 3 && stored.simId_os
          ? (osUnprotect(stored.simId_os)?.toString('utf8') ?? stored.simId ?? '')
          : (stored.simId ?? '');
      if (storedSimId && storedSimId !== activeSimId && sessionKeyOrNull()) {
        const liveIds = sessions.live().map((session) => session.id);
        sessions.revokeAll('sim-changed');
        lockSession();
        repository.lock?.();
        activeSimId = '';
        status.error = 'SIM changed — unlock required';
        emit('status', status);
        for (const sessionId of liveIds) emit('locked', { reason: 'sim-changed', sessionId });
        if (liveIds.length === 0) emit('locked', { reason: 'sim-changed' });
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
const run = (
  file: string,
  args: string[],
  options?: { timeoutMs?: number },
): Promise<{ ok: boolean; out: string }> =>
  new Promise((resolve) => {
    const timeoutMs = options?.timeoutMs ?? 30_000;
    execFile(file, args, { windowsHide: true, timeout: timeoutMs }, (error, stdout, stderr) => {
      const timedOut =
        error instanceof Error && 'killed' in error && (error as { killed?: boolean }).killed;
      resolve({
        ok: !error,
        out: timedOut
          ? `${file} timed out after ${timeoutMs}ms`
          : String(stdout || stderr || error?.message || ''),
      });
    });
  });
const provider = createDefaultProvider(run);
const dialup = new DialupAdapter(config.dialup, run, () => provider.discoverDialupProfiles());
const dataTransports = new DataTransportSelector(() => provider.discoverDataTransports());
const dataState = async (): Promise<Record<string, unknown>> => {
  const candidates = await dataTransports.all();
  return { ...(await dialup.state()), selected: candidates[0], candidates };
};
const clean = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/[\r\n"]/g, '').trim() : '';
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
      await selectMessageStore(command, match[1]).catch((): undefined => undefined);
      const lines = await command(`AT+CMGR=${match[2]}`);
      const pdu = lines.find((value) => /^[0-9A-F]{20,}$/i.test(value));
      if (pdu) {
        sms.ingest(pdu);
        await command(`AT+CMGD=${match[2]}`).catch((): undefined => undefined);
      }
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
  lockMinutes: config.lockMinutes,
  sessionMaxMinutes: config.sessionMaxMinutes,
  https: config.https === true,
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
  () => provider.listModems(),
  () => {
    void syncSimIdentity();
    const moved = portChange(lastPort, status);
    if (moved) {
      try {
        void repository
          .audit?.({
            action: 'modem.port-changed',
            detail: `${moved.previous} -> ${moved.current}`,
          })
          ?.catch(() => {});
      } catch {
        /* audit must never break status reporting */
      }
      emit('port', moved);
    }
    if (status.connected) lastPort = status.port;
    emit('status', status);
  },
);
const routes = createModemRoutes({
  db,
  status,
  clean,
  phoneCountry: () => getDefaultCountry() || undefined,
  sendSms: (to: string, text: string) => lifecycle.sendSms(to, text),
  save: repository.save,
  importAll: () => sms.import(command),
  purgeAll: () => sms.purge(command),
  ussd: (code: string): Promise<UssdResult> => ussd.start(code),
  network: () => network.read(),
  pbRead: (store: string) => phonebook.read(store),
  pbStores: () => phonebook.stores(),
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
    const editable = [
      'port',
      'baud',
      'dialup',
      'profile',
      'captureRaw',
      'capturePath',
      'lockMinutes',
      'sessionMaxMinutes',
    ] as const;
    const fieldSchema = (key: (typeof editable)[number]) => {
      switch (key) {
        case 'baud':
          return configInt('baud');
        case 'captureRaw':
          return configFlag('captureRaw');
        case 'lockMinutes':
          return lockMinutes();
        case 'sessionMaxMinutes':
          return sessionMaxMinutes();
        default:
          return configString(key);
      }
    };
    for (const key of editable) {
      const value = body[key];
      if (value === undefined) continue;
      (next[key] as never) = parseField(fieldSchema(key), value) as never;
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
routes['GET /api/state'] = async (_body, _params, ctx) => {
  if (validSession(ctx?.sessionId)) return simScopedState(db, status, activeSimId);
  return { status, sms: [], sent: [], calls: [], ussd: [] };
};
const auth = createAuthRoutes({
  rootDir: process.cwd(),
  repository,
  activeSimId: () => activeSimId,
  sendSms: (to, text) => lifecycle.sendSms(to, text),
  sessions,
  emitSessionLocked: (sessionIds) => {
    for (const id of sessionIds) emit('locked', { reason: 'lock', sessionId: id });
  },
});
Object.assign(routes, auth);
routes['GET /api/ports'] = async () => {
  // Bounded like discovery: a wedged stack must not hang the handler.
  const [listed, modems] = await Promise.all([
    withTimeout(SerialPort.list(), 8000, 'serial listing timed out').catch(
      (): Awaited<ReturnType<typeof SerialPort.list>> => [],
    ),
    provider.listModems(),
  ]);
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
  const original = handler;
  routes[key] = async (body, params, ctx) => {
    if (!allowedUnauthenticated.has(key) && !validSession(ctx?.sessionId))
      throw Object.assign(new Error('profile is locked — unlock first'), { statusCode: 423 });
    return original(body, params, ctx);
  };
}
const carrierWatch = new CarrierWatch(command);
let lastCarrier = '';
let slowTick = 0;
setInterval(() => {
  const before = new Set(sessions.live().map((session) => session.id));
  const swept = sessions.sweep({
    limits: sessionLimits(),
    simId: activeSimId || undefined,
  });
  const revoked = swept.idle + swept.expired + swept.simChanged;
  if (revoked > 0) {
    try {
      void repository
        .audit?.({
          action: 'session.sweep',
          detail: `idle=${swept.idle} expired=${swept.expired} sim-changed=${swept.simChanged}`,
        })
        ?.catch(() => {});
    } catch {
      /* audit must never break the sweeper */
    }
  }
  const hadKey = Boolean(sessionKeyOrNull());
  lockIfIdle();
  if (revoked > 0 || (hadKey && !sessionKeyOrNull())) {
    if (swept.simChanged > 0) {
      activeSimId = '';
      status.error = 'SIM changed — unlock required';
    } else if (swept.idle > 0) status.error = 'Auto-locked after inactivity';
    else if (swept.expired > 0) status.error = 'Session expired — unlock again';
    emit('status', status);
    const gone = [...before].filter((id) => !sessions.live().some((session) => session.id === id));
    const reason = swept.simChanged > 0 ? 'sim-changed' : 'session';
    for (const sessionId of gone) emit('locked', { reason, sessionId });
    if (gone.length === 0) emit('locked', { reason });
  }
  // Slow cadence (~30s): re-verify the SIM even when the port never flapped,
  // and surface carrier changes live. Failures stay silent here — the
  // heartbeat owns drop detection and the watch keeps its old baseline.
  slowTick += 1;
  if (slowTick % 6 === 0 && status.connected) {
    void (async () => {
      try {
        await syncSimIdentity();
        const snapshot = await carrierWatch.poll();
        if (snapshot) {
          const key = JSON.stringify(snapshot);
          if (key !== lastCarrier) {
            lastCarrier = key;
            emit('carrier', snapshot);
          }
        }
      } catch {
        /* never break the sweeper */
      }
    })();
  }
}, 5000).unref();
const server = new HttpServerAdapter({
  port: config.http,
  rootDir: process.cwd(),
  token: config.authToken,
  routes,
  sse,
  https: config.https === true,
  validateSessionId: (id) => {
    const record = sessions.get(id);
    return Boolean(record && !record.revoked);
  },
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
  sessions.close();
}
void start();
process.once('SIGINT', () => {
  void stop();
});
process.once('SIGTERM', () => {
  void stop();
});
