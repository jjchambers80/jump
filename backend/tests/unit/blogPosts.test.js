// Content › Blog posts (spec 026): sanitiser, status derivation, tags, validators.

import { jest } from '@jest/globals';
import { ValidationError } from '../../src/middleware/errorHandler.js';
import { excerptFromHtml, htmlToText, sanitizeContentHtml } from '../../src/utils/sanitizeHtml.js';
import { normalizeTags, postStatus } from '../../src/services/BlogPostService.js';
import {
  validateCreateBlogPost,
  validateUpdateBlogPost,
} from '../../src/api/validators/blogValidators.js';

describe('sanitizeContentHtml', () => {
  it('strips scripts, styles, handlers and unsafe schemes', () => {
    const dirty =
      '<p onclick="x()">Hi <script>alert(1)</script><style>p{}</style><a href="javascript:alert(1)">bad</a> <a href="https://x.test" target="_blank">ok</a></p><img src="data:image/png;base64,AAAA"><img src="https://x.test/a.png" alt="A" onerror="x()">';
    const clean = sanitizeContentHtml(dirty);
    expect(clean).not.toMatch(/script|style|onclick|onerror|javascript:|data:/);
    expect(clean).toContain('<a href="https://x.test" target="_blank" rel="noopener">ok</a>');
    expect(clean).toContain('<img src="https://x.test/a.png" alt="A" />');
    expect(clean).toContain('<a>bad</a>');
  });

  it('demotes h1 and keeps block structure', () => {
    expect(
      sanitizeContentHtml('<h1>Title</h1><ul><li>a</li></ul><hr><blockquote>q</blockquote>')
    ).toBe('<h2>Title</h2><ul><li>a</li></ul><hr /><blockquote>q</blockquote>');
    expect(sanitizeContentHtml(null)).toBe('');
  });

  it('derives text and excerpts', () => {
    expect(htmlToText('<p>Hello   <b>world</b></p>')).toBe('Hello world');
    const long = `<p>${Array.from({ length: 50 }, (_, i) => `w${i}`).join(' ')}</p>`;
    expect(excerptFromHtml(long, 5)).toBe('w0 w1 w2 w3 w4…');
    expect(excerptFromHtml('<p>short</p>', 5)).toBe('short');
  });
});

describe('postStatus', () => {
  const now = new Date('2026-09-19T12:00:00Z');
  it('is hidden, scheduled or visible', () => {
    expect(postStatus({ isVisible: false, publishedAt: null }, now)).toBe('hidden');
    expect(postStatus({ isVisible: true, publishedAt: null }, now)).toBe('visible');
    expect(
      postStatus({ isVisible: true, publishedAt: new Date('2026-09-19T11:00:00Z') }, now)
    ).toBe('visible');
    expect(
      postStatus({ isVisible: true, publishedAt: new Date('2026-09-20T00:00:00Z') }, now)
    ).toBe('scheduled');
    expect(
      postStatus({ isVisible: false, publishedAt: new Date('2026-09-20T00:00:00Z') }, now)
    ).toBe('hidden');
  });
});

describe('normalizeTags', () => {
  it('trims, collapses whitespace and dedupes case-insensitively', () => {
    expect(normalizeTags([' vendors ', 'Vendors', 'a  b', '', 'a b'])).toEqual(['vendors', 'a b']);
    expect(normalizeTags(undefined)).toEqual([]);
  });
});

describe('blog post validators', () => {
  const run = (fn, body) => {
    const next = jest.fn();
    fn({ body }, {}, next);
    return next.mock.calls[0]?.[0];
  };
  it('requires a title on create and whitelists keys', () => {
    expect(run(validateCreateBlogPost, { content: '<p>x</p>' })).toBeInstanceOf(ValidationError);
    expect(run(validateCreateBlogPost, { title: 'Hi' })).toBeUndefined();
    expect(run(validateCreateBlogPost, { title: 'Hi', bogus: 1 })).toBeInstanceOf(ValidationError);
    expect(run(validateCreateBlogPost, { title: 'Hi', tags: ['a', 3] })).toBeInstanceOf(
      ValidationError
    );
    expect(run(validateCreateBlogPost, { title: 'Hi', publishedAt: 'nope' })).toBeInstanceOf(
      ValidationError
    );
    expect(
      run(validateCreateBlogPost, {
        title: 'Hi',
        publishedAt: '2026-10-01T09:00:00Z',
        isVisible: true,
      })
    ).toBeUndefined();
  });
  it('accepts partial updates but not empty ones', () => {
    expect(run(validateUpdateBlogPost, { excerpt: null })).toBeUndefined();
    expect(run(validateUpdateBlogPost, {})).toBeInstanceOf(ValidationError);
    expect(run(validateUpdateBlogPost, { seoTitle: 'x'.repeat(71) })).toBeInstanceOf(
      ValidationError
    );
  });
});
