import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { HttpServerAdapter } from '../src/interfaces/http/http-server-adapter.js';
import { SseHub } from '../src/interfaces/http/sse-hub.js';
import type { ApiBody } from '../src/interfaces/http/api-router.js';

test('HTTP adapter enforces host, authentication, JSON, and dispatch', async () => {
  const routes = {
    'GET /health': async () => ({ ok: true }),
    'POST /api/echo': async (body: ApiBody) => body,
  };
  const adapter = new HttpServerAdapter({
    port: 34567,
    rootDir: process.cwd(),
    token: 'secret',
    routes,
    sse: new SseHub(),
  });
  await adapter.start();
  const request = (
    options: http.RequestOptions,
    body?: string,
  ): Promise<{ status: number; value: string }> =>
    new Promise((resolve) => {
      const req = http.request({ ...options, port: 34567 }, (response) => {
        let value = '';
        response.on('data', (chunk) => {
          value += chunk;
        });
        response.on('end', () => resolve({ status: response.statusCode || 0, value }));
      });
      req.end(body);
    });
  assert.equal(
    (
      await request({
        method: 'GET',
        path: '/health',
        headers: { Host: 'localhost:34567', Authorization: 'Bearer wrong' },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await request({
        method: 'GET',
        path: '/health',
        headers: { Host: 'localhost:34567', Authorization: 'Basic secret' },
      })
    ).status,
    401,
  );
  assert.equal(
    (await request({ method: 'GET', path: '/health', headers: { Host: 'localhost:34567' } }))
      .status,
    401,
  );
  assert.equal(
    (
      await request({
        method: 'GET',
        path: '/health',
        headers: { Host: 'localhost:34567', Authorization: 'Bearer secret' },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request(
        {
          method: 'POST',
          path: '/api/echo',
          headers: {
            Host: 'localhost:34567',
            Authorization: 'Bearer secret',
            'content-type': 'application/json',
          },
        },
        '{"ok":true}',
      )
    ).status,
    200,
  );
  await adapter.stop();
});

test('HTTP adapter rejects startup when its port is already occupied', async () => {
  const blocker = http.createServer((_request, response) => response.end());
  await new Promise<void>((resolve) => blocker.listen(34568, '127.0.0.1', resolve));
  const adapter = new HttpServerAdapter({
    port: 34568,
    rootDir: process.cwd(),
    routes: {},
    sse: new SseHub(),
  });
  await assert.rejects(adapter.start(), /EADDRINUSE/);
  await new Promise<void>((resolve) => blocker.close(() => resolve()));
});

test('HTTP adapter bootstraps protected GUI access with a same-origin session cookie', async () => {
  const adapter = new HttpServerAdapter({
    port: 34569,
    rootDir: process.cwd(),
    token: 'secret',
    routes: { 'GET /health': async () => ({ ok: true }) },
    sse: new SseHub(),
  });
  await adapter.start();
  const request = (
    path: string,
    headers: http.OutgoingHttpHeaders = {},
  ): Promise<{ status: number; headers: http.IncomingHttpHeaders }> =>
    new Promise((resolve) => {
      const req = http.request({ port: 34569, path, headers }, (response) => {
        response.resume();
        response.on('end', () =>
          resolve({ status: response.statusCode || 0, headers: response.headers }),
        );
      });
      req.end();
    });

  test('HTTP adapter serves generated frontend assets safely', async () => {
    const adapter = new HttpServerAdapter({
      port: 34570,
      rootDir: process.cwd(),
      routes: {},
      sse: new SseHub(),
    });
    await adapter.start();
    const request = (path: string): Promise<{ status: number; type?: string }> =>
      new Promise((resolve) => {
        const req = http.request({ port: 34570, path }, (response) => {
          response.resume();
          response.on('end', () =>
            resolve({ status: response.statusCode || 0, type: response.headers['content-type'] }),
          );
        });
        req.end();
      });
    const asset = fs
      .readdirSync(path.join(process.cwd(), 'public', 'assets'))
      .find((file) => file.endsWith('.js'));
    assert.ok(asset);
    assert.equal((await request(`/assets/${asset}`)).status, 200);
    assert.equal((await request('/../package.json')).status, 404);
    await adapter.stop();
  });
  const bootstrap = await request('/?token=secret');
  assert.equal(bootstrap.status, 200);
  const cookie = bootstrap.headers['set-cookie']?.[0]?.split(';')[0];
  assert.ok(cookie);
  assert.equal((await request('/health', { Cookie: cookie })).status, 200);
  await adapter.stop();
});
