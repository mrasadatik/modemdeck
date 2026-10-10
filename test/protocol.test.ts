import test from 'node:test';
import assert from 'node:assert/strict';
import { isGsm7, splitSms, validatePhone, validateUssd } from '../src/domain/services/protocol.js';
import { decodePdu } from '../src/domain/services/sms-codec.js';

test('validates generic phone numbers and USSD safely', () => {
  assert.equal(validatePhone('+8801712345678'), true);
  assert.equal(validatePhone('abc"\\r'), false);
  assert.equal(validateUssd('*121#'), true);
  assert.equal(validateUssd('AT+CMGS=1'), false);
});

test('splits GSM-7 by septet units and preserves characters', () => {
  const input = 'a'.repeat(160) + '^x';
  const parts = splitSms(input);
  assert.equal(isGsm7(input), true);
  assert.equal(parts.length, 2);
  assert.equal(parts.join(''), input);
  assert.ok([...parts[0]].reduce((n, c) => n + (c === '^' ? 2 : 1), 0) <= 153);
});

test('splits Unicode by code point without surrogate corruption', () => {
  const input = '😀'.repeat(100);
  const parts = splitSms(input);
  assert.equal(parts.join(''), input);
  assert.ok(parts.every((p) => [...p].join('') === p));
  assert.equal(parts[0].length, 134); // UTF-16 length: 67 supplementary code points
});

test('decodes stored SMS-DELIVER PDUs from SIM/modem storage', () => {
  const decoded = decodePdu(
    '07915892000000F0040C91881017325476' + '00' + '00' + '62018021030000' + '04' + 'D4F29C0E',
  );
  assert.deepEqual(decoded, {
    from: '+880171234567',
    ts: '2026-10-08T12:30:00+00:00',
    text: 'Test',
    ref: 0,
    seq: 1,
    total: 1,
  });
});

test('decodes SMS-STATUS-REPORT PDUs kept in SR storage', () => {
  const scts = '62018021030000';
  const decoded = decodePdu('0002000C91881017325476' + scts + scts + '00');
  assert.equal(decoded?.from, '+880171234567');
  assert.equal(decoded?.ts, '2026-10-08T12:30:00+00:00');
  assert.match(decoded?.text ?? '', /^Delivery report: delivered/);
  assert.equal(decoded?.total, 1);
});

test('decodes SMS-SUBMIT PDUs stored as sent mail', () => {
  const decoded = decodePdu('0001000C91881017325476' + '00' + '00' + '02' + 'C834');
  assert.equal(decoded?.from, '+880171234567');
  assert.equal(decoded?.text, 'Hi');
});

test('rejects unknown message types without throwing', () => {
  assert.equal(decodePdu('0003000C91881017325476' + '00'.repeat(16)), null);
  assert.equal(decodePdu('zzzz'), null);
  assert.equal(decodePdu('00'), null);
});
