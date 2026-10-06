import test from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../src/infrastructure/events/event-bus.js';
import { createApiRouter } from '../src/interfaces/http/api-router.js';
import { AtCommandEngine } from '../src/infrastructure/at/at-engine.js';
import { createSmsCodec } from '../src/domain/services/sms-codec.js';
import fs from 'node:fs';
import path from 'node:path';

test('event bus observes and unsubscribes safely', () => {
  const bus = new EventBus();
  const values: unknown[] = [];
  const off = bus.on('status', (value) => values.push(value));
  bus.emit('status', 'connected');
  off();
  bus.emit('status', 'closed');
  assert.deepEqual(values, ['connected']);
});

test('AT engine serializes commands and resolves response lines', async () => {
  const writes: string[] = [];
  const transport = {
    isOpen: true,
    write: (value: string | Buffer): void => {
      writes.push(value.toString());
    },
  };
  const engine = new AtCommandEngine(transport);
  const first = engine.execute('AT');
  const second = engine.execute('AT+CSQ');
  assert.deepEqual(writes, ['AT\r']);
  engine.receive('AT\r\nOK\r\n');
  assert.deepEqual(writes, ['AT\r', 'AT+CSQ\r']);
  engine.receive('+CSQ: 20,0\r\nOK\r\n');
  assert.deepEqual(await first, []);
  assert.deepEqual(await second, ['+CSQ: 20,0']);
});

test('AT engine handles SMS prompts and routes unsolicited responses', async () => {
  const writes: string[] = [],
    urcs: string[] = [];
  const transport = {
    isOpen: true,
    write: (value: string | Buffer): void => {
      writes.push(value.toString());
    },
  };
  const engine = new AtCommandEngine(transport, { onUrc: (value) => urcs.push(value) });
  const command = engine.execute('AT+CMGS=12', 1000, '001122');
  engine.receive('> ');
  engine.receive('+CMTI: "ME",1\r\nOK\r\n');
  assert.deepEqual(writes, ['AT+CMGS=12\r', '001122\x1a']);
  assert.deepEqual(urcs, ['+CMTI: "ME",1']);
  await command;
});

test('API router preserves method/path boundaries', async () => {
  const router = createApiRouter({ 'GET /api/ping': async () => ({ ok: true }) });
  assert.deepEqual(await router('GET', '/api/ping', {}, new URLSearchParams()), { ok: true });
  await assert.rejects(router('POST', '/api/ping', {}), /not found/);
});

test('SMS strategy selects GSM7 or Unicode and splits messages', () => {
  const codec = createSmsCodec();
  assert.equal(codec.dataCodingScheme('hello'), 0);
  assert.equal(codec.dataCodingScheme('😀'), 8);
  assert.equal(codec.split('a'.repeat(161)).length, 2);
});

test('domain layer remains independent of infrastructure and delivery adapters', () => {
  const root = path.resolve('src', 'domain');
  const files = fs
    .readdirSync(root, { recursive: true })
    .filter((file): file is string => typeof file === 'string' && file.endsWith('.ts'));
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotMatch(source, /from ['"](?:node:|serialport|http)/);
    assert.doesNotMatch(source, /from ['"][^'"]*(?:infrastructure|interfaces\/http)/);
  }
});
