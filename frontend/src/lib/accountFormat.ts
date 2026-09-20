// Date/time formatting that honours the account's language and time zone
// (spec 030). Reads `locale` / `timeZone` from the session; a null time zone
// means the browser's. Adopted on the account pages first; other admin
// surfaces migrate as spec 021 settles store-vs-account display rules.

'use client';

import { useSession } from 'next-auth/react';
import { DEFAULT_LOCALE } from './locales';

export interface AccountFormatPrefs {
  locale: string;
  timeZone: string | null;
}

export function formatDateTime(
  value: Date | string | number,
  prefs: AccountFormatPrefs,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(prefs.locale || DEFAULT_LOCALE, {
      ...options,
      ...(prefs.timeZone ? { timeZone: prefs.timeZone } : {}),
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat(DEFAULT_LOCALE, options).format(date);
  }
}

export function useAccountFormat() {
  const { data: session } = useSession();
  const prefs: AccountFormatPrefs = {
    locale: session?.user?.locale || DEFAULT_LOCALE,
    timeZone: session?.user?.timeZone ?? null,
  };
  return {
    prefs,
    formatDateTime: (value: Date | string | number, options?: Intl.DateTimeFormatOptions) =>
      formatDateTime(value, prefs, options),
  };
}
