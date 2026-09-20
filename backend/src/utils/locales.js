// Account preferences (spec 030): the locales the admin UI offers and the
// time-zone check. Mirror of frontend/src/lib/locales.ts — change both.

export const SUPPORTED_LOCALES = [{ code: 'en-US', label: 'English (United States)' }];

export const DEFAULT_LOCALE = 'en-US';

export function isSupportedLocale(code) {
  return SUPPORTED_LOCALES.some((locale) => locale.code === code);
}

/** True when the runtime's Intl accepts the IANA identifier. */
export function isValidTimeZone(value) {
  if (typeof value !== 'string' || !value || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
