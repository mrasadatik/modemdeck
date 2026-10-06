import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DialupAdapter,
  NetworkService,
  UssdSessionManager,
} from '../src/application/modem-services.js';

test('USSD session manager routes responses and prevents overlap', async () => {
  let command = '';
  const manager = new UssdSessionManager(async (value) => {
    command = value;
    return [];
  });
  const pending = manager.start('*123#');
  await assert.rejects(manager.start('*456#'), /another USSD/);
  assert.match(command, /AT\+CUSD=1/);
  manager.receive('+CUSD: 0,"00480069",8');
  assert.deepEqual(await pending, { text: 'Hi', more: false, status: 0 });
});

test('network service tolerates unsupported commands', async () => {
  const service = new NetworkService(async (command) =>
    command === 'AT+CSQ' ? ['+CSQ: 99,0'] : Promise.reject(new Error('unsupported')),
  );
  const result = await service.read();
  assert.equal(result.signal, null);
  assert.equal(result.cs, 'n/a');
});

test('dial-up adapter builds platform command and reports state', async () => {
  const calls: string[][] = [];
  let connected = false;
  const adapter = new DialupAdapter('entry', async (_file, args) => {
    calls.push(args);
    if (args.length > 0) connected = true;
    return { ok: true, out: connected ? 'Connected to entry' : 'No connections' };
  });
  assert.equal((await adapter.set(true)).on, true);
  assert.deepEqual(calls, [[], ['entry'], []]);
});

test('dial-up adapter discovers one matching existing profile', async () => {
  const calls: string[][] = [];
  const adapter = new DialupAdapter(
    '',
    async (_file, args) => {
      calls.push(args);
      return { ok: true, out: 'Connected to Wireless Terminal' };
    },
    async () => ['Wireless Terminal'],
  );
  assert.deepEqual(await adapter.profile(), {
    configured: true,
    name: 'Wireless Terminal',
    source: 'discovered',
  });
  assert.deepEqual(await adapter.state(), {
    configured: true,
    on: true,
    name: 'Wireless Terminal',
  });
  assert.deepEqual(calls[0], []);
});

test('dial-up adapter does not reconnect or disconnect an already matching state', async () => {
  const calls: string[][] = [];
  const adapter = new DialupAdapter('entry', async (_file, args) => {
    calls.push(args);
    return { ok: true, out: 'Connected to entry' };
  });
  await adapter.set(true);
  await adapter.set(true);
  assert.deepEqual(calls, [[], []]);
});
