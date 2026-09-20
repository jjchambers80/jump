import { jest } from '@jest/globals';
import { resolveSlug, slugify, uniqueSlug } from '../../src/utils/slug.js';

describe('shared URL slug utilities', () => {
  it('normalizes punctuation, accents and repeated whitespace', () => {
    expect(slugify('  Raleigh Rétro — Gamers!!!  ')).toBe('raleigh-retro-gamers');
  });

  it('rejects a title that cannot produce a URL slug', () => {
    expect(() => resolveSlug({ title: '***' })).toThrow(
      'URL slug must contain letters or numbers'
    );
  });

  it('marks an explicitly supplied custom slug as customized', () => {
    expect(resolveSlug({ title: 'Game Expo', customSlug: ' Our 2026 Expo! ' })).toEqual({
      slug: 'our-2026-expo',
      slugCustomized: true,
    });
  });

  it('preserves a custom slug when the title changes and no slug is supplied', () => {
    expect(
      resolveSlug({
        title: 'Renamed Expo',
        currentSlug: 'the-expo',
        slugCustomized: true,
      })
    ).toEqual({ slug: 'the-expo', slugCustomized: true });
  });

  it('re-derives a generated slug when the title changes', () => {
    expect(
      resolveSlug({
        title: 'Renamed Expo',
        currentSlug: 'game-expo',
        slugCustomized: false,
      })
    ).toEqual({ slug: 'renamed-expo', slugCustomized: false });
  });

  it('suffixes duplicate slugs within the supplied scope and field', async () => {
    const model = {
      findFirst: jest
        .fn()
        .mockResolvedValueOnce({ id: 'existing-1' })
        .mockResolvedValueOnce({ id: 'existing-2' })
        .mockResolvedValueOnce(null),
    };

    await expect(
      uniqueSlug(model, {
        scope: { organizationId: 'org-1' },
        raw: 'About Us',
        field: 'handle',
      })
    ).resolves.toBe('about-us-3');
    expect(model.findFirst).toHaveBeenNthCalledWith(3, {
      where: { organizationId: 'org-1', handle: 'about-us-3' },
      select: { id: true },
    });
  });

  it('supports an explicit fallback for legacy callers with non-ASCII names', async () => {
    const model = { findFirst: jest.fn().mockResolvedValue(null) };

    await expect(uniqueSlug(model, { raw: '東京', fallback: 'org' })).resolves.toBe('org');
  });
});
