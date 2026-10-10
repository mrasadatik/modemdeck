import { describe, expect, it } from 'vitest';
import {
  callingCodeFor,
  exampleFor,
  formatNationalInput,
  maskFor,
  normalizeToE164,
  phoneIsValid,
  splitPhoneNumber,
} from './phone-numbers-lib.js';

describe('country coupling', () => {
  it('resolves calling codes strictly per country', () => {
    expect(callingCodeFor('BD')).toBe('+880');
    expect(callingCodeFor('US')).toBe('+1');
    expect(callingCodeFor('GB')).toBe('+44');
    expect(callingCodeFor('')).toBeNull();
    expect(callingCodeFor('XX')).toBeNull();
    expect(callingCodeFor('usa')).toBeNull();
  });

  it('provides libphonenumber-js examples per country', () => {
    expect(exampleFor('BD')?.national).toBe('01812-345678');
    expect(exampleFor('US')?.national).toBe('(201) 555-0123');
    expect(exampleFor('') ?? null).toBeNull();
    expect(exampleFor('XX') ?? null).toBeNull();
  });
});

describe('strict validation and normalization', () => {
  it('accepts only libphonenumber-js-valid numbers', () => {
    expect(phoneIsValid('+8801712345678')).toBe(true);
    expect(phoneIsValid('01712345678', 'BD')).toBe(true);
    expect(phoneIsValid('123')).toBe(false);
    expect(phoneIsValid('abc')).toBe(false);
    expect(phoneIsValid('')).toBe(false);
  });

  it('canonicalizes to E.164', () => {
    expect(normalizeToE164('01712345678', 'BD')).toBe('+8801712345678');
    expect(normalizeToE164('+8801712345678')).toBe('+8801712345678');
    expect(normalizeToE164('partial', 'BD')).toBeNull();
  });

  it('splits into coupled country, calling code and national parts', () => {
    expect(splitPhoneNumber('+8801812345678')).toEqual({
      e164: '+8801812345678',
      country: 'BD',
      callingCode: '+880',
      nationalNumber: '1812345678',
    });
    expect(splitPhoneNumber('01812345678', 'BD')?.e164).toBe('+8801812345678');
    expect(splitPhoneNumber('junk')).toBeNull();
    expect(splitPhoneNumber('')).toBeNull();
  });
});

describe('example-driven input mask', () => {
  it('tokenizes example formats into groups', () => {
    expect(maskFor('BD')).toEqual({ prefix: '', groups: [5, 6], separators: ['-'] });
    expect(maskFor('US')).toEqual({ prefix: '(', groups: [3, 3, 4], separators: [') ', '-'] });
    expect(maskFor('XX')).toBeNull();
  });

  it('groups partial input without dangling separators', () => {
    expect(formatNationalInput('017', 'BD')).toBe('017');
    expect(formatNationalInput('01712', 'BD')).toBe('01712');
    expect(formatNationalInput('017123', 'BD')).toBe('01712-3');
    expect(formatNationalInput('01712345678', 'BD')).toBe('01712-345678');
    expect(formatNationalInput('201', 'US')).toBe('(201');
    expect(formatNationalInput('20155501', 'US')).toBe('(201) 555-01');
    expect(formatNationalInput('2015550123', 'US')).toBe('(201) 555-0123');
  });

  it('strips non-digits, caps length and falls back without an example', () => {
    expect(formatNationalInput('01-712 34ab', 'BD')).toBe('01712-34');
    expect(formatNationalInput('017123456789012345678', 'BD')).toBe('01712-3456789012');
    expect(formatNationalInput('12345', 'XX')).toBe('12345');
    expect(formatNationalInput('', 'BD')).toBe('');
  });
});
