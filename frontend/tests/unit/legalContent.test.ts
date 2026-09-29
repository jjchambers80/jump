import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LEGAL_VERSIONS } from '../../../backend/src/config/legal.js';
import { isLegalSlug, parseFrontMatter } from '@/lib/legalContent';

const here = dirname(fileURLToPath(import.meta.url));

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

// The launch checklist says the front-matter `version` must equal the backend's
// LEGAL_VERSIONS entry, and nothing enforced it. A page reading one version
// while the backend serves another means the stored LegalAcceptance rows
// disagree with the document that was shown; the other direction makes every
// apply and checkout 400 with LEGAL_VERSION_STALE.
describe('legal front matter vs backend LEGAL_VERSIONS', () => {
  const CONTENT_DIR = join(here, '../../content/legal');
  /** The slugs the backend versions and the consent flow echoes. */
  const VERSIONED = ['terms', 'privacy'] as const;
  const fileFor = (slug: string) => join(CONTENT_DIR, `${slug}.md`);

  // Counsel's text has not landed, so the per-slug checks below skip. That is
  // only safe because this test fails if a document arrives under a name they
  // do not cover — otherwise `organizer-terms.md` (or a typo) would slip past
  // the parity check forever while the suite stayed green.
  it('only holds files named after a documented slug', () => {
    const docs = readdirSync(CONTENT_DIR).filter((f) => f.endsWith('.md') && f !== 'README.md');
    for (const file of docs) {
      expect(isLegalSlug(file.replace(/\.md$/, '')), `unexpected ${file}`).toBe(true);
    }
  });

  for (const slug of VERSIONED) {
    it(`${slug}.md declares the version the backend serves`, (ctx) => {
      // Reported as skipped, not passed: an empty content dir must never read
      // as "parity verified".
      if (!existsSync(fileFor(slug))) ctx.skip();
      const { meta } = parseFrontMatter(readFileSync(fileFor(slug), 'utf8'));
      expect(meta.version, `content/legal/${slug}.md front matter`).toBe(LEGAL_VERSIONS[slug]);
    });
  }
});
