import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, localeLabel } from '@/lib/locales';

// backend/src/utils/locales.js is the other half of the same list (spec 030).
const backendSource = readFileSync(new URL('../../../backend/src/utils/locales.js', import.meta.url), 'utf8');

describe('SUPPORTED_LOCALES', () => {
  it('matches the backend list code for code', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(backendSource).toContain(`code: '${locale.code}'`);
      expect(backendSource).toContain(`label: '${locale.label}'`);
    }
    const backendCount = (backendSource.match(/code: '/g) || []).length;
    expect(backendCount).toBe(SUPPORTED_LOCALES.length);
  });

  it('includes the default', () => {
    expect(SUPPORTED_LOCALES.some((l) => l.code === DEFAULT_LOCALE)).toBe(true);
  });

  it('labels known codes and echoes unknown ones', () => {
    expect(localeLabel('en-US')).toBe('English (United States)');
    expect(localeLabel('xx-YY')).toBe('xx-YY');
    expect(localeLabel(null)).toBe(DEFAULT_LOCALE);
  });
});
