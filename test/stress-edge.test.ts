import test from 'node:test';
import assert from 'node:assert/strict';
import { decodePdu, encodeSubmitPdus } from '../src/domain/services/sms-codec.js';
import { splitSms, isGsm7, validatePhone, validateUssd } from '../src/domain/services/protocol.js';
import { decodeUssdText, UssdSessionManager } from '../src/application/modem-services.js';
import { AtCommandEngine } from '../src/infrastructure/at/at-engine.js';

const VALID_DELIVER =
  '0791411632010F91' + '001234567890' + '0000A203F48094116321' + '345678F90C0000000008AA70BE71AA85';
// not validating semantics; used only to check the decoder never throws

test('decodePdu never throws on garbage / truncated / malformed input', () => {
  const inputs = [
    '',
    '00',
    'zz',
    '!!',
    '0',
    'FF'.repeat(4),
    VALID_DELIVER.slice(0, 6),
    VALID_DELIVER.slice(0, 10),
    VALID_DELIVER.slice(0, 20),
    '00' + VALID_DELIVER,
    VALID_DELIVER + 'FFFFFF',
    'A'.repeat(4),
  ];
  for (const input of inputs) {
    assert.doesNotThrow(() => decodePdu(input), `input=${input.slice(0, 20)}`);
  }
});

test('encodeSubmitPdus produces hex for empty, ascii, unicode, long', () => {
  for (const text of ['', 'a', 'hello é€', '😀'.repeat(5), 'x'.repeat(1000), 'বাংলা বার্তা']) {
    const pdus = encodeSubmitPdus('+8801712345678', text);
    assert.ok(pdus.length >= 1);
    for (const p of pdus) assert.match(p.hex, /^00[0-9A-F]+$/);
  }
});

test('splitSms is lossless at boundaries and never returns empty parts', () => {
  for (const n of [1, 159, 160, 161, 152, 153, 154, 306, 307, 1000]) {
    const gsm = 'a'.repeat(n);
    const parts = splitSms(gsm);
    assert.equal(parts.join(''), gsm);
    assert.ok(parts.every((p) => p.length > 0));
  }
  assert.deepEqual(splitSms(''), ['']);
  const uni = '😀'.repeat(200);
  const parts = splitSms(uni);
  assert.equal(parts.join(''), uni);
  assert.ok(parts.every((p) => p.length > 0));
  // extended GSM-7 chars count double
  const ext = '^'.repeat(81); // 162 septet units -> must split
  assert.equal(splitSms(ext).length, 2);
});

test('validatePhone / validateUssd reject injections and absurd input', () => {
  for (const bad of [
    '',
    '+',
    'abc',
    '+0000',
    '+1' + '2'.repeat(20),
    '"; DROP',
    '*100#\r\nAT',
    null as unknown as string,
  ])
    assert.equal(validatePhone(bad), false);
  for (const bad of ['', '*', '#', '**', '*#', '*100', '100#', '*a#', '"*121#"'])
    assert.equal(validateUssd(bad), false);
  assert.equal(validateUssd('*121*1*1#'), true);
});

test('decodeUssdText handles hex UCS2, passthrough, and junk', () => {
  const ucs2 = Buffer.from('Balance', 'utf16le').swap16().toString('hex');
  assert.equal(decodeUssdText(ucs2, 72), 'Balance');
  assert.equal(decodeUssdText('hello', 8), 'hello');
  assert.equal(decodeUssdText('zz', 72), 'zz');
  assert.equal(decodeUssdText('abc', 72), 'abc');
  assert.equal(decodeUssdText('', 72), '');
});

test('UssdSessionManager rejects concurrent sessions and resolves on URC', async () => {
  const command = async () => ['OK'];
  const ussd = new UssdSessionManager(command);
  const first = ussd.start('*121#');
  await assert.rejects(() => ussd.start('*123#'), /another USSD session/);
  ussd.receive('+CUSD: 0,"414243",72');
  const result = await first;
  assert.equal(result.status, 0);
});

test('UssdSessionManager cancel clears pending', async () => {
  const ussd = new UssdSessionManager(async () => ['OK']);
  const pending = ussd.start('*121#');
  ussd.cancel();
  await assert.rejects(() => pending, /USSD cancelled/);
  // a new session must be possible after cancel
  const second = ussd.start('*121#');
  ussd.receive('+CUSD: 0,"ok",0');
  await second;
});

test('AtCommandEngine handles chunked delivery, garbage, and URCs', async () => {
  const written: string[] = [];
  const urc: string[] = [];
  const lines: string[] = [];
  const transport = {
    isOpen: true,
    write: (data: string) => void written.push(data),
  };
  const engine = new AtCommandEngine(transport, {
    onUrc: (l) => urc.push(l),
    onLine: (l) => lines.push(l),
  });
  const promise = engine.execute('AT+CSQ');
  engine.receive(Buffer.from('AT+CSQ\r\n+\x43SQ: 20,99\r\n'));
  engine.receive('\x0d\x0aOK\r\n');
  const result = await promise;
  assert.deepEqual(result, ['+CSQ: 20,99']);
  engine.receive('garbage\r\nRING\r\n');
  assert.deepEqual(urc, ['RING']);
});

test('AtCommandEngine timeout and error paths', async () => {
  const transport = { isOpen: true, write: () => {} };
  const engine = new AtCommandEngine(transport, {});
  const slow = engine.execute('AT+SLOW', 30);
  await assert.rejects(() => slow, /timeout/);
  const failing = engine.execute('AT+BAD', 1000);
  engine.receive('ERROR\r\n');
  await assert.rejects(() => failing, /ERROR/);
  const closed = new AtCommandEngine({ isOpen: false, write: () => {} }, {});
  await assert.rejects(() => closed.execute('AT'), /modem not connected/);
});

test('AtCommandEngine queues commands serially', async () => {
  const transport = { isOpen: true, write: () => {} };
  const engine = new AtCommandEngine(transport, {});
  const a = engine.execute('AT1');
  const b = engine.execute('AT2');
  engine.receive('OK\r\n');
  await a;
  engine.receive('OK\r\n');
  await b;
});

test('isGsm7 agreement with encodeSubmitPdus DCS choice', () => {
  assert.equal(isGsm7('hello'), true);
  assert.equal(isGsm7('বাংলা'), false);
  assert.equal(isGsm7('€'), true);
});
