import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import type { Examples } from 'libphonenumber-js';
import {
  callingCodeFor,
  exampleFor,
  normalizeToE164,
  phoneIsValid,
  splitPhoneNumber,
} from '../src/domain/services/phone-numbers.js';

const require = createRequire(import.meta.url);
const mobileExamples = require('libphonenumber-js/examples.mobile.json') as Examples;

test('strict validity is owned by libphonenumber-js', () => {
  assert.equal(phoneIsValid('+8801712345678'), true);
  assert.equal(phoneIsValid('+16502530000', 'US'), true);
  assert.equal(phoneIsValid('01712345678', 'BD'), true);
  assert.equal(phoneIsValid('abc"\\r'), false);
  assert.equal(phoneIsValid('123'), false);
  assert.equal(phoneIsValid('+8801712345678', 'US'), true);
  assert.equal(phoneIsValid(''), false);
});

test('normalization always yields canonical E.164', () => {
  assert.equal(normalizeToE164('+8801712345678'), '+8801712345678');
  assert.equal(normalizeToE164('01712345678', 'BD'), '+8801712345678');
  assert.equal(normalizeToE164('(650) 253-0000', 'US'), '+16502530000');
  assert.equal(normalizeToE164('not a number', 'BD'), null);
  assert.equal(normalizeToE164('123', 'BD'), null);
});

test('splitting couples country, calling code and national number', () => {
  assert.deepEqual(splitPhoneNumber('+8801712345678'), {
    e164: '+8801712345678',
    country: 'BD',
    callingCode: '+880',
    nationalNumber: '1712345678',
  });
  assert.deepEqual(splitPhoneNumber('01712345678', 'BD'), {
    e164: '+8801712345678',
    country: 'BD',
    callingCode: '+880',
    nationalNumber: '1712345678',
  });
  assert.equal(splitPhoneNumber('junk'), null);
  assert.equal(splitPhoneNumber(''), null);
});

test('calling codes resolve per country', () => {
  assert.equal(callingCodeFor('BD'), '+880');
  assert.equal(callingCodeFor('US'), '+1');
  assert.equal(callingCodeFor('GB'), '+44');
  assert.equal(callingCodeFor(''), null);
  assert.equal(callingCodeFor('XX'), null);
});

test('examples exist for common countries', () => {
  for (const country of ['BD', 'US', 'GB', 'IN']) {
    const example = exampleFor(country, mobileExamples);
    assert.ok(example, `expected an example for ${country}`);
    assert.ok(/^\+\d/.test(example.international));
    assert.ok(example.national.length >= 4);
  }
  assert.equal(exampleFor('', mobileExamples), null);
  assert.equal(exampleFor('XX', mobileExamples), null);
});
