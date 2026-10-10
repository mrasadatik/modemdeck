import {
  getCountries,
  getCountryCallingCode,
  getExampleNumber,
  isValidPhoneNumber,
  parsePhoneNumberFromString,
} from 'libphonenumber-js';
import type { CountryCode, Examples } from 'libphonenumber-js';

export const ALL_COUNTRIES = getCountries();
export const countryNames = (): Record<string, string> => {
  const names = new Intl.DisplayNames(['en'], { type: 'region' });
  return Object.fromEntries(ALL_COUNTRIES.map((cc) => [cc, names.of(cc) ?? cc]));
};

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
  /** Canonical E.164 form, e.g. +8801712345678. */
  e164: string;
  /** ISO 3166-1 alpha-2 country, e.g. BD. */
  country: string;
  /** Country calling code with plus, e.g. +880. */
  callingCode: string;
  /** National (rest) number digits, e.g. 1712345678. */
  nationalNumber: string;
}

/**
 * Strictly parse a number into its coupled parts (country, calling code,
 * national number) plus the canonical E.164 form. Returns null unless
 * libphonenumber-js considers the number valid.
 */
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

/** Country calling code with plus (e.g. +880 for BD), or null when unknown. */
export function callingCodeFor(country: string): string | null {
  try {
    if (!/^[A-Z]{2}$/.test(country)) return null;
    return `+${getCountryCallingCode(country as CountryCode)}`;
  } catch {
    return null;
  }
}

export interface CountryExample {
  /** National format as dialed locally, e.g. 01712-345678. */
  national: string;
  /** Full international format, e.g. +880 1712-345678. */
  international: string;
}

/**
 * libphonenumber-js example number for a country, or null when unknown.
 * Example metadata is injected (keeps this module free of Node-only JSON
 * loading); bundles ship e.g. `examples.mobile.json` (4KB).
 */
export function exampleFor(country: string, examples: Examples): CountryExample | null {
  try {
    if (!/^[A-Z]{2}$/.test(country)) return null;
    const example = getExampleNumber(country as CountryCode, examples);
    if (!example) return null;
    return { national: example.formatNational(), international: example.formatInternational() };
  } catch {
    return null;
  }
}
