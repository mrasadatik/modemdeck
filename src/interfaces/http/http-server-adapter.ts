import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { ApiBody, ApiRoutes } from './api-router.js';
import { createApiRouter } from './api-router.js';
import type { SseHub } from './sse-hub.js';

export interface HttpAdapterOptions {
  port: number;
  rootDir: string;
  token?: string;
  routes: ApiRoutes;
  sse: SseHub;
}
export class HttpServerAdapter {
  private readonly server: http.Server;
  private readonly counts = new Map<string, { count: number; reset: number }>();
  private lock = Promise.resolve();
  constructor(private readonly options: HttpAdapterOptions) {
    const dispatch = createApiRouter(options.routes);
    this.server = http.createServer(async (req, res) => {
      const id = this.correlation(req);
      const json = (code: number, value: unknown): void => {
        res.writeHead(code, {
          'content-type': 'application/json; charset=utf-8',
          'x-content-type-options': 'nosniff',
          'x-frame-options': 'DENY',
          'referrer-policy': 'no-referrer',
          'cache-control': 'no-store',
          'x-correlation-id': id,
        });
        res.end(JSON.stringify(value));
      };
      try {
        if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host || ''))
          return json(403, { error: 'bad host' });
        const url = new URL(req.url || '/', 'http://localhost');
        const bootstrap =
          req.method === 'GET' &&
          url.pathname === '/' &&
          this.hasValidBearerToken(
            url.searchParams.get('token') ? `Bearer ${url.searchParams.get('token')}` : undefined,
          );
        if (this.options.token && !bootstrap && !this.hasValidRequestAuth(req))
          return json(401, { error: 'authentication required' });
        if (!this.rate(req)) return json(429, { error: 'rate limit exceeded' });
        if (req.method === 'GET' && url.pathname === '/') {
          const headers: http.OutgoingHttpHeaders = {
            'content-type': 'text/html; charset=utf-8',
            'content-security-policy': "default-src 'self'; connect-src 'self'",
            'x-content-type-options': 'nosniff',
          };
          if (bootstrap)
            headers['set-cookie'] =
              `modemdeck_session=${encodeURIComponent(this.options.token || '')}; HttpOnly; SameSite=Strict; Path=/`;
          res.writeHead(200, headers);
          return res.end(fs.readFileSync(path.join(options.rootDir, 'public', 'index.html')));
        }
        if (req.method === 'GET' && url.pathname.startsWith('/assets/')) {
          const publicRoot = path.resolve(options.rootDir, 'public');
          const file = path.resolve(publicRoot, `.${url.pathname}`);
          if (
            !file.startsWith(`${publicRoot}${path.sep}`) ||
            !fs.existsSync(file) ||
            !fs.statSync(file).isFile()
          )
            return json(404, { error: 'not found' });
          const contentTypes: Record<string, string> = {
            '.js': 'text/javascript; charset=utf-8',
            '.css': 'text/css; charset=utf-8',
            '.map': 'application/json; charset=utf-8',
          };
          res.writeHead(200, {
            'content-type':
              contentTypes[path.extname(file).toLowerCase()] || 'application/octet-stream',
            'cache-control': 'public, max-age=31536000, immutable',
            'x-content-type-options': 'nosniff',
          });
          return res.end(fs.readFileSync(file));
        }
        if (url.pathname === '/events') {
          options.sse.add(res);
          return;
        }
        let body: ApiBody = {};
        if (req.method !== 'GET') {
          if (!(req.headers['content-type'] || '').toLowerCase().startsWith('application/json'))
            return json(415, { error: 'json only' });
          let raw = '';
          for await (const chunk of req) {
            raw += chunk.toString();
            if (Buffer.byteLength(raw) > 65536)
              return json(413, { error: 'request body too large' });
          }
          try {
            const parsed: unknown = raw ? JSON.parse(raw) : {};
            if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
              return json(400, { error: 'JSON object required' });
            body = parsed as ApiBody;
          } catch {
            return json(400, { error: 'invalid JSON' });
          }
        }
        const key = `${req.method} ${url.pathname}`;
        if (!options.routes[key]) return json(404, { error: 'not found' });
        const invoke = (): Promise<unknown> =>
          dispatch(req.method || 'GET', url.pathname, body, url.searchParams);
        const modem = ![
          'GET /api/state',
          'POST /api/sms/delete',
          'GET /api/data',
          'GET /health',
        ].includes(key);
        const result = modem ? this.lock.then(invoke, invoke) : invoke();
        if (modem)
          this.lock = result.then(
            (): undefined => undefined,
            (): undefined => undefined,
          );
        return json(200, await result);
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : String(reason);
        const status =
          typeof reason === 'object' &&
          reason !== null &&
          'statusCode' in reason &&
          typeof reason.statusCode === 'number'
            ? reason.statusCode
            : 500;
        json(status, { error: status >= 500 ? 'internal server error' : message });
      }
    });
  }
  async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        this.server.removeListener('listening', onListening);
        reject(error);
      };
      const onListening = (): void => {
        this.server.removeListener('error', onError);
        resolve();
      };
      this.server.once('error', onError);
      this.server.once('listening', onListening);
      this.server.listen(this.options.port, '127.0.0.1');
    });
  }
  async stop(): Promise<void> {
    this.options.sse.close();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
  private correlation(req: http.IncomingMessage): string {
    const value = req.headers['x-correlation-id'];
    return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,80}$/.test(value)
      ? value
      : createHash('sha256').update(`${Date.now()}-${Math.random()}`).digest('hex').slice(0, 16);
  }
  private hasValidBearerToken(authorization: string | undefined): boolean {
    if (!this.options.token || typeof authorization !== 'string') return false;
    const expected = Buffer.from(`Bearer ${this.options.token}`, 'utf8');
    const actual = Buffer.from(authorization, 'utf8');
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
  private hasValidRequestAuth(req: http.IncomingMessage): boolean {
    if (this.hasValidBearerToken(req.headers.authorization)) return true;
    const cookie = req.headers.cookie?.match(/(?:^|;\s*)modemdeck_session=([^;]+)/)?.[1];
    return this.hasValidBearerToken(cookie ? `Bearer ${decodeURIComponent(cookie)}` : undefined);
  }
  private rate(req: http.IncomingMessage): boolean {
    const key = req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const item = this.counts.get(key);
    if (!item || item.reset < now) {
      this.counts.set(key, { count: 1, reset: now + 60000 });
      return true;
    }
    item.count++;
    return item.count <= 120;
  }
}
