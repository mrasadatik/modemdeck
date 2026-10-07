import { getCountries } from 'libphonenumber-js';

export const ALL_COUNTRIES = getCountries();
export function countryNames(): Record<string, string> {
  const names = new Intl.DisplayNames(['en'], { type: 'region' });
  return Object.fromEntries(ALL_COUNTRIES.map((cc) => [cc, names.of(cc) ?? cc]));
}
