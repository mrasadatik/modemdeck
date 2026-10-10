import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  HttpServerAdapter,
  sessionIdFromRequest,
} from '../src/interfaces/http/http-server-adapter.js';
import type { HttpAdapterOptions } from '../src/interfaces/http/http-server-adapter.js';
import type { ApiRoutes } from '../src/interfaces/http/api-router.js';
import { SESSION_ENVELOPE } from '../src/interfaces/http/api-router.js';
import { SseHub } from '../src/interfaces/http/sse-hub.js';

test('session ids parse from header or cookie only', () => {
  const id = 'a'.repeat(32);
  const req = (headers: Record<string, string>): http.IncomingMessage =>
    ({ headers }) as unknown as http.IncomingMessage;
  assert.equal(sessionIdFromRequest(req({ 'x-session-id': id })), id);
  assert.equal(sessionIdFromRequest(req({ cookie: `modemdeck_sid=${id}` })), id);
  assert.equal(sessionIdFromRequest(req({ cookie: `other=1; modemdeck_sid=${id}` })), id);
  assert.equal(sessionIdFromRequest(req({})), undefined);
  assert.equal(sessionIdFromRequest(req({ 'x-session-id': 'short' })), undefined);
  assert.equal(sessionIdFromRequest(req({ cookie: 'modemdeck_sid=short' })), undefined);
});

async function withAdapter(routes: ApiRoutes, extra?: Partial<HttpAdapterOptions>) {
  const port = 34668 + Math.floor(Math.random() * 1000);
  const adapter = new HttpServerAdapter({
    port,
    rootDir: process.cwd(),
    routes,
    sse: new SseHub(),
    ...extra,
  });
  await adapter.start();
  const get = (
    target: string,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> =>
    new Promise((resolve, reject) => {
      http
        .get(
          { port, path: target, headers: { Host: `localhost:${port}`, ...headers }, agent: false },
          (res) => {
            let body = '';
            res.on('data', (chunk) => (body += chunk));
            res.on('end', () =>
              resolve({ status: res.statusCode || 0, headers: res.headers, body }),
            );
          },
        )
        .on('error', reject)
        .end();
    });
  return { adapter, get };
}

test('session envelope becomes an HttpOnly cookie and is stripped from the body', async () => {
  const id = 'b'.repeat(32);
  const { adapter, get } = await withAdapter({
    'GET /api/login': async () => ({ ok: true, [SESSION_ENVELOPE]: { set: id } }),
    'GET /api/logout': async () => ({ ok: true, [SESSION_ENVELOPE]: { clear: true } }),
  });
  try {
    const login = await get('/api/login');
    assert.equal(login.status, 200);
    assert.match(String(login.headers['set-cookie'] ?? ''), /modemdeck_sid=b{32}; HttpOnly/);
    assert.ok(!login.body.includes(SESSION_ENVELOPE));
    const logout = await get('/api/logout');
    assert.match(String(logout.headers['set-cookie'] ?? ''), /modemdeck_sid=;.*Expires=/);
  } finally {
    await adapter.stop();
  }
});

test('sid bootstrap sets the cookie only for valid sessions', async () => {
  const id = 'c'.repeat(32);
  const { adapter, get } = await withAdapter(
    { 'GET /nothing': async () => ({}) },
    {
      validateSessionId: (candidate: string) => candidate === id,
    },
  );
  try {
    const good = await get(`/?sid=${id}`);
    assert.equal(good.status, 200);
    assert.match(String(good.headers['set-cookie'] ?? ''), new RegExp(`modemdeck_sid=${id}`));
    const bad = await get('/?sid=deadbeefdeadbeefdeadbeefdeadbeef');
    assert.equal(bad.status, 200);
    assert.equal(bad.headers['set-cookie'], undefined);
  } finally {
    await adapter.stop();
  }
});
