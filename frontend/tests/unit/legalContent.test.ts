import { describe, expect, it } from 'vitest';
import { isLegalSlug, parseFrontMatter } from '../../src/lib/legalContent';

describe('parseFrontMatter', () => {
  it('splits the front matter block from the body', () => {
    const { meta, body } = parseFrontMatter(
      '---\ntitle: Terms of Service\nversion: 2026-10-01\n---\n# Terms\n\nBody.'
    );
    expect(meta).toEqual({ title: 'Terms of Service', version: '2026-10-01' });
    expect(body).toBe('# Terms\n\nBody.');
  });

  it('returns the whole source as body when there is no front matter', () => {
    expect(parseFrontMatter('# Just text')).toEqual({ meta: {}, body: '# Just text' });
  });

  it('keeps colons inside values and strips quotes', () => {
    const { meta } = parseFrontMatter('---\ntitle: "Terms: the fine print"\n---\n');
    expect(meta.title).toBe('Terms: the fine print');
  });
});

describe('isLegalSlug', () => {
  it('accepts only the documented slugs', () => {
    expect(isLegalSlug('terms')).toBe(true);
    expect(isLegalSlug('organizer-terms')).toBe(true);
    expect(isLegalSlug('../secrets')).toBe(false);
    expect(isLegalSlug('admin')).toBe(false);
  });
});
