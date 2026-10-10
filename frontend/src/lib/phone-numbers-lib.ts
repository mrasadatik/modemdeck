import {
  getCountries,
  getCountryCallingCode,
  getExampleNumber,
  isValidPhoneNumber,
  parsePhoneNumberFromString,
} from 'libphonenumber-js';
import type { CountryCode } from 'libphonenumber-js';
import mobileExamples from 'libphonenumber-js/examples.mobile.json';

export const ALL_COUNTRIES = getCountries();
/** Placeholder hint country when none is selected (keeps the historic +880 hint). */
export const FALLBACK_COUNTRY = 'BD';
export function countryNames(): Record<string, string> {
  const names = new Intl.DisplayNames(['en'], { type: 'region' });
  return Object.fromEntries(ALL_COUNTRIES.map((cc) => [cc, names.of(cc) ?? cc]));
}

export function normalizeToE164(value: string, defaultCountry?: string): string | null {
  try {
    const parsed = parsePhoneNumberFromString(value, defaultCountry as never);
    return parsed?.isValid() ? parsed.number : null;
  } catch {
    return null;
  }
}

export function phoneIsValid(value: string, defaultCountry?: string): boolean {
  try {
    return isValidPhoneNumber(value, defaultCountry as never);
  } catch {
    return false;
  }
}

export interface SplitPhoneNumber {
  e164: string;
  country: string;
  callingCode: string;
  nationalNumber: string;
}

export function splitPhoneNumber(value: string, defaultCountry?: string): SplitPhoneNumber | null {
  try {
    const parsed = parsePhoneNumberFromString(String(value ?? '').trim(), defaultCountry as never);
    if (!parsed || !parsed.isValid()) return null;
    return {
      e164: parsed.number,
      country: parsed.country ?? defaultCountry ?? '',
      callingCode: `+${parsed.countryCallingCode}`,
      nationalNumber: parsed.nationalNumber,
    };
  } catch {
    return null;
  }
}

export function callingCodeFor(country: string): string | null {
  try {
    if (!/^[A-Z]{2}$/.test(country)) return null;
    return `+${getCountryCallingCode(country as CountryCode)}`;
  } catch {
    return null;
  }
}

export interface CountryExample {
  national: string;
  international: string;
}

export function exampleFor(country: string): CountryExample | null {
  try {
    if (!/^[A-Z]{2}$/.test(country)) return null;
    const example = getExampleNumber(country as CountryCode, mobileExamples);
    if (!example) return null;
    return { national: example.formatNational(), international: example.formatInternational() };
  } catch {
    return null;
  }
}

export interface ExampleMask {
  prefix: string;
  groups: number[];
  separators: string[];
}

/**
 * Tokenize an example national format into digit-group sizes and the
 * separators around them, e.g. "(201) 555-0123" → prefix "(", groups
 * [3,3,4], separators [") ", "-"]. Drives the progressive input mask.
 */
export function maskFor(country: string): ExampleMask | null {
  const example = exampleFor(country);
  if (!example) return null;
  const tokens = example.national.match(/\d+|\D+/g) ?? [];
  let prefix = '';
  const groups: number[] = [];
  const separators: string[] = [];
  for (const token of tokens) {
    if (/^\d+$/.test(token)) groups.push(token.length);
    else if (groups.length === 0) prefix += token;
    else separators[groups.length - 1] = `${separators[groups.length - 1] ?? ''}${token}`;
  }
  if (!groups.length) return null;
  return { prefix, groups, separators };
}

/**
 * Progressively group raw input digits per the country's example mask.
 * Separators appear only once the preceding group is complete, so partial
 * input never shows dangling punctuation. Falls back to bare digits when
 * the country has no example.
 */
export function formatNationalInput(raw: string, country: string): string {
  const digits = String(raw ?? '')
    .replace(/\D/g, '')
    .slice(0, 15);
  const mask = maskFor(country);
  if (!mask) return digits;
  let out = digits ? mask.prefix : '';
  let pos = 0;
  mask.groups.forEach((size, index) => {
    if (pos >= digits.length) return;
    out += digits.slice(pos, pos + size);
    pos += size;
    if (pos < digits.length && mask.separators[index]) out += mask.separators[index];
  });
  if (pos < digits.length) out += digits.slice(pos);
  return out;
}
