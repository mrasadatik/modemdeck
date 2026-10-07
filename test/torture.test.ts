import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decodePdu, encodeSubmitPdus } from '../src/domain/services/sms-codec.js';
import { splitSms, validatePhone, validateUssd } from '../src/domain/services/protocol.js';
import { SmsIngestionService } from '../src/application/modem-services.js';
import { AtCommandEngine } from '../src/infrastructure/at/at-engine.js';
import { DataTransportSelector } from '../src/application/data-transport-selector.js';
import { HttpServerAdapter } from '../src/interfaces/http/http-server-adapter.js';
import { SseHub } from '../src/interfaces/http/sse-hub.js';
import { loadConfig } from '../src/infrastructure/config/config.js';
import type { ModemDatabase } from '../src/domain/entities/types.js';

const rnd = (n: number): string =>
  Array.from({ length: n }, () => '0123456789ABCDEF'[Math.floor(Math.random() * 16)]).join('');

test('TORTURE: decodePdu survives 2000 random hex blobs without throwing', () => {
  for (let i = 0; i < 2000; i++) {
    const hex = rnd(Math.floor(Math.random() * 200));
    assert.doesNotThrow(() => decodePdu(hex));
  }
  for (let i = 0; i < 500; i++) {
    const hex = Array.from({ length: Math.floor(Math.random() * 100) }, () =>
      Math.floor(Math.random() * 256)
        .toString(16)
        .padStart(2, '0'),
    ).join('');
    assert.doesNotThrow(() => decodePdu(hex));
  }
});

test('TORTURE: encodeSubmitPdus degenerate addresses never produce invalid hex', () => {
  for (const to of ['', '+', '0', 'abcdef', '+' + '1'.repeat(40), '  +8801  ', '++1212']) {
    const pdus = encodeSubmitPdus(to, 'hello');
    for (const p of pdus) assert.match(p.hex, /^00[0-9A-F]*$/);
  }
});

test('TORTURE: splitSms coerces garbage input instead of crashing', () => {
  for (const value of [
    null,
    undefined,
    0,
    false,
    NaN,
    {},
    [],
    '🚩🏳️‍🌈'.repeat(60),
    '\u0000'.repeat(300),
  ]) {
    assert.doesNotThrow(() => splitSms(value as unknown as string));
  }
  const emoji = '🏳️‍🌈'.repeat(40);
  assert.equal(splitSms(emoji).join(''), emoji);
});

test('TORTURE: validators reject pathological strings quickly', () => {
  const long = '9'.repeat(100000);
  assert.equal(validatePhone(long), false);
  assert.equal(validateUssd('*'.repeat(100000)), false);
  assert.equal(validatePhone('+৮৮০১৭১২'), false);
});

// Build a raw SMS-DELIVER PDU (delivers) directly for ingestion tests.
const buildDeliver = (opts: {
  from: string;
  dcs: number;
  udhi?: Buffer;
  udl: number;
  ud: Buffer;
}): string => {
  const digits = opts.from.replace(/\D/g, '');
  const padded = digits.length % 2 ? digits + 'F' : digits;
  const oa: number[] = [];
  for (let i = 0; i < padded.length; i += 2) oa.push(parseInt(padded[i + 1] + padded[i], 16));
  const ud = opts.udhi ? Buffer.concat([opts.udhi, opts.ud]) : opts.ud;
  const pdu = Buffer.from([
    0x00, // SCA length 0
    opts.udhi ? 0x44 : 0x04,
    digits.length,
    0x91,
    ...oa,
    0x00,
    opts.dcs,
    0x24,
    0x05,
    0x16,
    0x37,
    0x02,
    0x80,
    0x00, // SCTS
    ud.length,
    ...ud,
  ]);
  return pdu.toString('hex').toUpperCase();
};

const dbFixture = (): {
  db: ModemDatabase;
  repository: { state: ModemDatabase; save: () => Promise<void> };
} => {
  const db: ModemDatabase = {
    sms: [],
    sent: [],
    calls: [],
    ussd: [],
    contacts: [],
    parts: {},
    seen: {},
  } as ModemDatabase;
  return { db, repository: { state: db, save: async () => {} } };
};

test('TORTURE: SMS ingestion dedupes, reassembles out-of-order multipart, ignores junk', async () => {
  const { db, repository } = dbFixture();
  const published: unknown[] = [];
  const sms = new SmsIngestionService(db, repository as never, (_e, v) => published.push(v));
  assert.equal(sms.ingest('00'), false);
  assert.equal(sms.ingest('ZZZ'), false);
  const partText = (s: string) => Buffer.from(s, 'utf16le').swap16();
  const udhi = (seq: number) => Buffer.from([6, 8, 4, 0, 7, 2, seq]);
  const m1 = buildDeliver({
    from: '+8801712345678',
    dcs: 8,
    udhi: udhi(1),
    udl: 0,
    ud: partText('Hello '),
  });
  const m2 = buildDeliver({
    from: '+8801712345678',
    dcs: 8,
    udhi: udhi(2),
    udl: 0,
    ud: partText('World'),
  });
  assert.equal(sms.ingest(m2), false); // incomplete
  assert.equal(sms.ingest(m2), false); // duplicate part
  assert.equal(sms.ingest(m1), true);
  assert.equal(db.sms[0].text, 'Hello World');
  assert.equal(sms.ingest(m1), false); // full-message dedupe via seen
  assert.equal(published.length, 1);
});

test('TORTURE: DataTransportSelector degrades unknown methods to the bottom', async () => {
  const selector = new DataTransportSelector(
    async () =>
      [
        { method: 'unknown' as never, name: 'x' },
        { method: 'ndis' as never, name: 'y' },
        { method: 'qmi' as never, name: 'z' },
      ] as never,
  );
  const first = await selector.select();
  assert.equal(first?.method, 'ndis');
});

test('TORTURE: AtCommandEngine survives binary garbage and multi-line URCs', async () => {
  const urc: string[] = [];
  const engine = new AtCommandEngine(
    { isOpen: true, write: () => {} },
    { onUrc: (l) => urc.push(l) },
  );
  for (let i = 0; i < 200; i++)
    engine.receive(
      Buffer.concat([
        Buffer.from(
          Array.from({ length: 16 }, () => [0x01, 0x7f, 0xff, 0x80, 0xfe, 0x10, 0x20, 0x30][i % 8]),
        ),
        Buffer.from('\r\n'),
      ]),
    );
  engine.receive('+CUSD: 0,"par');
  engine.receive('tial",72\r\n');
  engine.receive('\x00\xff garbage \r\nRING\r\n');
  assert.ok(urc.some((line) => line.startsWith('+CUSD')));
  assert.ok(urc.includes('RING'));
});

test('TORTURE: AtCommandEngine queue rejection on disconnect mid-flight', async () => {
  const engine = new AtCommandEngine({ isOpen: true, write: () => {} }, {});
  const a = engine.execute('AT1', 5000);
  const b = engine.execute('AT2', 5000);
  const c = engine.execute('AT3', 5000);
  engine.disconnect();
  await assert.rejects(() => a);
  await assert.rejects(() => b);
  await assert.rejects(() => c);
});

test('TORTURE: CMGS data prompt flow writes payload and ctrl-Z', async () => {
  const written: string[] = [];
  const engine = new AtCommandEngine({ isOpen: true, write: (d: string) => written.push(d) }, {});
  const pending = engine.execute('AT+CMGS=24', 1000, 'Hello\x1a');
  engine.receive('\r\n> ');
  engine.receive('\r\n+CMGS: 99\r\n\r\nOK\r\n');
  const lines = await pending;
  assert.deepEqual(lines, ['+CMGS: 99']);
  assert.ok(written.some((w) => w.includes('Hello')));
});

test('TORTURE: loadConfig ignores corrupt config.json and validates env overrides', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modem-cfg-'));
  fs.writeFileSync(path.join(dir, 'config.json'), '{invalid json!!!');
  const config = loadConfig(dir, {});
  assert.equal(config.http, 3000);
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ http: 'not-a-number' }));
  assert.throws(() => loadConfig(dir, {}));
  assert.throws(() => loadConfig(dir, { PORT: 'abc' }));
  assert.equal(loadConfig(dir, { PORT: '3105' }).http, 3105);
  fs.rmSync(dir, { recursive: true, force: true });
});

const withServer = async (
  routes: Record<string, (body?: never) => Promise<unknown>>,
  token: string | undefined,
  fn: (port: number) => Promise<void>,
) => {
  const adapter = new HttpServerAdapter({
    port: 0 as unknown as number,
    rootDir: process.cwd(),
    token,
    routes: routes as never,
    sse: new SseHub(),
  });
  await new Promise<void>((resolve) => {
    (adapter as never as { server: http.Server }).server.once('listening', resolve);
    adapter.start().then(resolve, () => {});
  });
  const address = (adapter as never as { server: http.Server }).server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  try {
    await fn(port);
  } finally {
    await adapter.stop();
  }
};

test('TORTURE: HTTP fuzz — bad hosts, junk JSON, oversize, traversal, unknown routes', async () => {
  await withServer({ 'GET /health': async () => ({ ok: true }) }, 'tok', async (port) => {
    const call = (
      pathStr: string,
      headers: http.OutgoingHttpHeaders = {},
      body?: string,
      method = 'GET',
    ): Promise<{ status: number }> =>
      new Promise((resolve, reject) => {
        const req = http.request(
          {
            port,
            method,
            path: pathStr,
            headers: { Host: `localhost:${port}`, Authorization: 'Bearer tok', ...headers },
          },
          (res) => {
            res.resume();
            res.on('end', () => resolve({ status: res.statusCode || 0 }));
          },
        );
        req.on('error', reject);
        req.end(body);
      });
    assert.equal((await call('/health', {}, undefined)).status, 200);
    assert.equal((await call('/health', { Host: 'evil.com' })).status, 403);
    assert.equal(
      (
        await call(
          '/health',
          {
            'content-type': 'application/json',
            Authorization: 'Bearer tok',
            Host: `localhost:${port}`,
          },
          '{',
          'POST',
        )
      ).status,
      400,
    );
    assert.equal(
      (await call('/health', { 'content-type': 'text/plain' }, 'hi', 'POST')).status,
      415,
    );
    assert.equal(
      (await call('/health', { 'content-type': 'application/json' }, '[1,2,3]', 'POST')).status,
      400,
    );
    assert.equal(
      (await call('/health', { 'content-type': 'application/json' }, 'x'.repeat(70000), 'POST'))
        .status,
      413,
    );
    assert.equal((await call('/../package.json')).status, 404);
    assert.equal((await call('/assets/..%2f..%2fpackage.json')).status, 404);
    assert.equal((await call('/nope')).status, 404);
    assert.equal(
      (await call('/health', { 'x-correlation-id': 'bad value with spaces!!' })).status,
      200,
    );
  });
});

test('TORTURE: HTTP route handler statusCode propagates and 500s stay generic', async () => {
  await withServer(
    {
      'GET /bad': async () => {
        throw Object.assign(new Error('secret internals'), { statusCode: 503 });
      },
      'GET /crash': async () => {
        throw new Error('stack trace here');
      },
    },
    undefined,
    async (port) => {
      const get = (pathStr: string) =>
        new Promise<{ status: number; body: string }>((resolve) => {
          http.get({ port, path: pathStr, headers: { Host: `localhost:${port}` } }, (res) => {
            let body = '';
            res.on('data', (c) => (body += c));
            res.on('end', () => resolve({ status: res.statusCode || 0, body }));
          });
        });
      const bad = await get('/bad');
      assert.equal(bad.status, 503);
      const crash = await get('/crash');
      assert.equal(crash.status, 500);
      assert.ok(!crash.body.includes('stack trace'));
    },
  );
});

test('TORTURE: rapid concurrent requests all get correct responses', async () => {
  await withServer({ 'GET /health': async () => ({ ok: true }) }, undefined, async (port) => {
    const results = await Promise.all(
      Array.from(
        { length: 40 },
        () =>
          new Promise<number>((resolve) => {
            http.get({ port, path: '/health', headers: { Host: `localhost:${port}` } }, (res) => {
              res.resume();
              res.on('end', () => resolve(res.statusCode || 0));
            });
          }),
      ),
    );
    assert.ok(results.every((status) => status === 200));
  });
});
