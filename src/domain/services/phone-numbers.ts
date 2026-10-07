import { getCountries, isValidPhoneNumber, parsePhoneNumberFromString } from 'libphonenumber-js';

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
