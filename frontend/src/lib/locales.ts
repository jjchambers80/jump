// Account preferences (spec 030): the locales the admin UI offers.
// Mirror of backend/src/utils/locales.js — change both.

export interface SupportedLocale {
  code: string;
  label: string;
}

export const SUPPORTED_LOCALES: SupportedLocale[] = [{ code: 'en-US', label: 'English (United States)' }];

export const DEFAULT_LOCALE = 'en-US';

export function localeLabel(code: string | null | undefined): string {
  return SUPPORTED_LOCALES.find((locale) => locale.code === code)?.label ?? code ?? DEFAULT_LOCALE;
}
