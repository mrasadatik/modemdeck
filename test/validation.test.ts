import test from 'node:test';
import assert from 'node:assert/strict';
import {
  apnName,
  atCommand,
  contactForm,
  dataToggle,
  forwardingForm,
  forwardingReason,
  formErrors,
  loginForm,
  messageId,
  parseField,
  phoneE164,
  phonebookIndex,
  profileForm,
  setupForm,
  smsForm,
  smsText,
  ussdCode,
} from '../src/domain/validation/schemas.js';

function messageOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('expected a 400');
}

function statusOf(fn: () => unknown): number {
  try {
    fn();
  } catch (error) {
    return (error as { statusCode?: number }).statusCode ?? 500;
  }
  throw new Error('expected a 400');
}

test('field schemas accept valid input and canonicalize', () => {
  assert.equal(parseField(phoneE164('BD', 'bad'), '01712345678'), '+8801712345678');
  assert.equal(parseField(phoneE164(undefined, 'bad'), '+8801712345678'), '+8801712345678');
  assert.equal(parseField(ussdCode(), '*121#'), '*121#');
  assert.equal(parseField(apnName(), 'internet'), 'internet');
  assert.equal(parseField(atCommand(), 'AT+CSQ'), 'AT+CSQ');
  assert.equal(parseField(messageId(), 'abc123ABC123'), 'abc123ABC123');
  assert.equal(parseField(dataToggle(), true), true);
  assert.equal(parseField(phonebookIndex(), ''), '');
  assert.equal(parseField(phonebookIndex(), '7'), 7);
  assert.equal(parseField(forwardingReason(), 2), 2);
});

test('field schemas reject with stable endpoint messages', () => {
  assert.equal(
    messageOf(() => parseField(phoneE164('BD', 'invalid phone number'), '12')),
    'invalid phone number',
  );
  assert.equal(
    messageOf(() => parseField(smsText(), '')),
    'message must contain 1-2000 characters',
  );
  assert.equal(
    messageOf(() => parseField(smsText(), '😀'.repeat(2001))),
    'message must contain 1-2000 characters',
  );
  assert.equal(
    messageOf(() => parseField(ussdCode(), 'AT+CMGS=1')),
    'invalid USSD code',
  );
  assert.equal(
    messageOf(() => parseField(apnName(), 'a b')),
    'invalid APN',
  );
  assert.equal(
    messageOf(() => parseField(atCommand(), 'ATD123;')),
    'command is not permitted',
  );
  assert.equal(
    messageOf(() => parseField(atCommand(), 'AT+CMGS=1')),
    'command is not permitted',
  );
  assert.equal(
    messageOf(() => parseField(messageId(), 'xyz')),
    'invalid message id',
  );
  assert.equal(
    messageOf(() => parseField(phonebookIndex(), 0)),
    'invalid phonebook index',
  );
  assert.equal(
    messageOf(() => parseField(phonebookIndex(), 10000)),
    'invalid phonebook index',
  );
  assert.equal(
    messageOf(() => parseField(forwardingReason(), 4)),
    'invalid forwarding request',
  );
  assert.equal(
    messageOf(() => parseField(dataToggle(), 'yes')),
    'on must be a boolean',
  );
  assert.equal(
    statusOf(() => parseField(phoneE164('BD', 'bad'), '12')),
    400,
  );
});

test('formErrors flattens per-field messages for the UI', () => {
  const errors = formErrors(setupForm('BD'), {
    name: '',
    simLabel: 'lab',
    recovery: '01712345678',
    password: 'pass1234',
    confirm: 'mismatch',
  });
  assert.equal(errors.name, 'name and simLabel are required');
  assert.equal(errors._root, 'passwords do not match');
  assert.ok(!('recovery' in errors));
  assert.deepEqual(
    formErrors(setupForm('BD'), {
      name: 'A',
      simLabel: 'B',
      recovery: '01712345678',
      password: 'pass1234',
      confirm: 'pass1234',
    }),
    {},
  );
  const login = formErrors(loginForm(), { password: 'ab' });
  assert.equal(login.password, 'invalid password');
});

test('whole-form schemas cover sms, contact, forwarding and profile bodies', () => {
  assert.deepEqual(formErrors(smsForm('BD'), { to: '01712345678', text: 'hi' }), {});
  assert.equal(
    formErrors(smsForm('BD'), { to: '01712345678', text: '' }).text,
    'message must contain 1-2000 characters',
  );
  assert.deepEqual(formErrors(contactForm('BD'), { name: 'A', number: '+8801712345678' }), {});
  assert.equal(
    formErrors(contactForm('BD'), { name: '', number: '+8801712345678' }).name,
    'invalid contact name',
  );
  assert.deepEqual(formErrors(forwardingForm('BD'), { reason: 1, number: '+8801712345678' }), {});
  assert.deepEqual(
    formErrors(profileForm(), { name: '', country: 'USA' }).country,
    'invalid country',
  );
  assert.deepEqual(formErrors(profileForm(), { name: '', country: '' }), {});
});
