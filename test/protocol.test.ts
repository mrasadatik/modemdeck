import test from 'node:test';
import assert from 'node:assert/strict';
import { isGsm7, splitSms, validatePhone, validateUssd } from '../src/domain/services/protocol.js';

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
