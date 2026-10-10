import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DialupAdapter,
  ForwardingService,
  NetworkService,
  PhonebookService,
  SmsIngestionService,
  UssdSessionManager,
  messageStores,
  parsePhonebookLine,
  selectMessageStore,
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

test('dial-up connect passes a bounded timeout to the platform command', async () => {
  const seen: Array<{ args: string[]; options?: { timeoutMs?: number } }> = [];
  let connected = false;
  const adapter = new DialupAdapter(
    'entry',
    async (_file, args, options?: { timeoutMs?: number }) => {
      seen.push({ args, options });
      if (args.length > 0) connected = true;
      return { ok: true, out: connected ? 'Connected to entry' : 'No connections' };
    },
  );
  await adapter.set(true);
  const dial = seen.find((call) => call.args.length > 0);
  assert.ok(dial?.options?.timeoutMs && dial.options.timeoutMs > 0);
});

const smsStore = () => ({
  sms: [],
  sent: [],
  calls: [],
  ussd: [],
  contacts: [],
  parts: {},
  seen: {},
});

test('message store discovery prefers MT and falls back to SM/ME', async () => {
  const withMt = await messageStores(async (command) =>
    command === 'AT+CPMS=?' ? ['+CPMS: ("SM","ME","MT"),("SM","ME"),("SM","ME")'] : [],
  );
  assert.deepEqual(withMt, ['MT', 'SM', 'ME']);
  const withoutMt = await messageStores(async (command) =>
    command === 'AT+CPMS=?' ? ['+CPMS: ("SM","ME"),("SM"),("SM")'] : [],
  );
  assert.deepEqual(withoutMt, ['SM', 'ME']);
  const failing = await messageStores(async () => {
    throw new Error('unsupported');
  });
  assert.deepEqual(failing, ['SM', 'ME']);
});

test('message store selection falls back to the three-parameter form', async () => {
  const calls: string[] = [];
  await selectMessageStore(async (command) => {
    calls.push(command);
    if (!command.includes(',')) throw new Error('single form unsupported');
    return [];
  }, 'SM');
  assert.deepEqual(calls, ['AT+CPMS="SM"', 'AT+CPMS="SM","SM","SM"']);
});

test('SMS import walks every discovered store with per-store counts', async () => {
  const pdu =
    '07915892000000F0040C91881017325476' + '00' + '00' + '62018021030000' + '04' + 'D4F29C0E';
  const selected: string[] = [];
  const service = new SmsIngestionService(
    smsStore() as never,
    { save: async () => {} } as never,
    () => {},
  );
  const result = await service.import(async (command) => {
    if (command === 'AT+CPMS=?') return ['+CPMS: ("SM","ME"),("SM"),("SM")'];
    if (command.startsWith('AT+CPMS=')) {
      selected.push(command);
      return [];
    }
    if (command === 'AT+CMGL=4')
      return selected[selected.length - 1]?.includes('"SM"')
        ? ['+CMGL: 3,1,,143', pdu, '+CMGL: 7,1,,143', pdu]
        : [];
    if (command.startsWith('AT+CMGD=')) return [];
    throw new Error(`unexpected ${command}`);
  });
  assert.equal(result.imported, 1);
  assert.deepEqual(result.perStore, { SM: 1 });
  assert.ok(selected.some((command) => command.includes('"SM"')));
  assert.ok(selected.some((command) => command.includes('"ME"')));
});

test('SMS purge clears every discovered store', async () => {
  const cleared: string[] = [];
  const service = new SmsIngestionService(
    smsStore() as never,
    { save: async () => {} } as never,
    () => {},
  );
  const result = await service.purge(async (command) => {
    if (command === 'AT+CPMS=?') return ['+CPMS: ("SM","ME","SR"),("SM"),("SM")'];
    if (command.startsWith('AT+CPMS=')) return [];
    if (command === 'AT+CMGD=1,4') {
      cleared.push('cleared');
      return [];
    }
    throw new Error(`unexpected ${command}`);
  });
  assert.deepEqual(result, { SM: true, ME: true, SR: true });
  assert.equal(cleared.length, 3);
});

test('phonebook store discovery parses CPBS=? with fallback', async () => {
  const service = new PhonebookService(async (command) => {
    if (command === 'AT+CPBS=?') return ['+CPBS: ("SM","ME","MT","EN")'];
    throw new Error(`unexpected ${command}`);
  });
  assert.deepEqual(await service.stores(), ['SM', 'ME', 'MT', 'EN']);
  const fallback = new PhonebookService(async () => {
    throw new Error('unsupported');
  });
  assert.deepEqual(await fallback.stores(), ['SM', 'ME']);
});

test('phonebook read pages wide ranges and tolerates plain-text names', async () => {
  const requested: string[] = [];
  const service = new PhonebookService(async (command) => {
    if (command === 'AT+CPBS="SM"') return [];
    if (command === 'AT+CSCS="UCS2"') return [];
    if (command === 'AT+CSCS="IRA"') return [];
    if (command === 'AT+CPBR=?') return ['+CPBR: (1-120),30,30'];
    if (command.startsWith('AT+CPBR=')) {
      requested.push(command);
      if (command === 'AT+CPBR=1,50')
        return [
          '+CPBR: 1,"+880171234567",145,"0041006C006900630065"',
          '+CPBR: 2,"+880181234567",145,"Plain Name"',
        ];
      throw new Error('range rejected');
    }
    throw new Error(`unexpected ${command}`);
  });
  const entries = await service.read('SM');
  assert.deepEqual(entries, [
    { index: 1, number: '+880171234567', name: 'Alice' },
    { index: 2, number: '+880181234567', name: 'Plain Name' },
  ]);
  assert.deepEqual(requested, ['AT+CPBR=1,50', 'AT+CPBR=51,100', 'AT+CPBR=101,120']);
});

test('phonebook line parser ignores garbage and nameless edge cases', () => {
  assert.deepEqual(parsePhonebookLine('garbage'), []);
  assert.deepEqual(parsePhonebookLine('+CPBR: 3,"+123",129,""'), [
    { index: 3, number: '+123', name: '' },
  ]);
  assert.deepEqual(parsePhonebookLine('+CPBR: 4,"+123",129'), [
    { index: 4, number: '+123', name: '' },
  ]);
});

test('forwarding read tolerates spacing variants and surfaces errors', async () => {
  const service = new ForwardingService(async (command) => {
    if (command === 'AT+CCFC=0,2') return ['+CCFC: 1, 1,"+880171234567",145'];
    if (command === 'AT+CCFC=1,2') return ['+CCFC: 0,2', '+CCFC: 0,4', '+CCFC: 0,1'];
    if (command === 'AT+CCFC=2,2') return ['+CCFC: 1,7'];
    throw new Error('timeout: AT+CCFC=3,2');
  });
  assert.deepEqual(await service.read(), [
    { reason: 0, active: true, number: '+880171234567' },
    { reason: 1, active: false, number: '' },
    { reason: 2, active: true, number: '' },
    { reason: 3, active: false, number: '', error: 'timeout: AT+CCFC=3,2' },
  ]);
});
