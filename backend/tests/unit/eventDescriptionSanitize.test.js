// Unit tests for event description sanitising
// Tests that sanitizeContentHtml and htmlToText behave correctly for event
// description scenarios: stripping unsafe HTML, preserving allowed tags,
// handling null/empty input, and plain-text conversion.

import { jest } from '@jest/globals';
import {
  sanitizeContentHtml,
  htmlToText,
  excerptFromHtml,
} from '../../src/utils/sanitizeHtml.js';

describe('Event description sanitising', () => {
  describe('sanitizeContentHtml', () => {
    it('strips script tags from event description', () => {
      const dirty = '<p>Welcome!</p><script>alert("hack")</script><p>Details</p>';
      const clean = sanitizeContentHtml(dirty);
      expect(clean).not.toMatch(/<script>/);
      expect(clean).toContain('<p>Welcome!</p>');
      expect(clean).toContain('<p>Details</p>');
    });

    it('strips event handler attributes like onclick, onerror', () => {
      const dirty = '<p onclick="x()">Click me</p><img src="x" onerror="steal()">';
      const clean = sanitizeContentHtml(dirty);
      expect(clean).not.toMatch(/onclick/);
      expect(clean).not.toMatch(/onerror/);
      expect(clean).toContain('<p>Click me</p>');
      expect(clean).toContain('<img');
    });

    it('strips javascript: and data: URIs', () => {
      const dirty =
        '<a href="javascript:alert(1)">bad</a><a href="https://ok.com">good</a><img src="data:image/png;base64,abc">';
      const clean = sanitizeContentHtml(dirty);
      expect(clean).not.toMatch(/javascript:/);
      expect(clean).not.toMatch(/data:/);
      expect(clean).toContain('<a>bad</a>');
      expect(clean).toContain('<a href="https://ok.com">good</a>');
    });

    it('preserves allowed block and inline tags', () => {
      const input =
        '<h2>Section</h2><p>Text with <strong>bold</strong>, <em>italic</em>, <u>underline</u>, <s>strike</s></p><ul><li>One</li><li>Two</li></ul><blockquote>Quote</blockquote>';
      const clean = sanitizeContentHtml(input);
      expect(clean).toContain('<h2>Section</h2>');
      expect(clean).toContain('<strong>bold</strong>');
      expect(clean).toContain('<em>italic</em>');
      expect(clean).toContain('<u>underline</u>');
      expect(clean).toContain('<s>strike</s>');
      expect(clean).toContain('<ul><li>One</li><li>Two</li></ul>');
      expect(clean).toContain('<blockquote>Quote</blockquote>');
    });

    it('demotes h1 to h2', () => {
      expect(sanitizeContentHtml('<h1>Title</h1>')).toBe('<h2>Title</h2>');
    });

    it('adds rel="noopener" to _blank links', () => {
      const clean = sanitizeContentHtml('<a href="https://x.test" target="_blank">link</a>');
      expect(clean).toContain('target="_blank"');
      expect(clean).toContain('rel="noopener"');
    });

    it('strips target from non-_blank links', () => {
      const clean = sanitizeContentHtml('<a href="https://x.test" target="_self">link</a>');
      expect(clean).not.toMatch(/target/);
    });

    it('returns empty string for null input', () => {
      expect(sanitizeContentHtml(null)).toBe('');
    });

    it('returns empty string for undefined input', () => {
      expect(sanitizeContentHtml(undefined)).toBe('');
    });

    it('returns empty string for empty input', () => {
      expect(sanitizeContentHtml('')).toBe('');
    });

    it('strips style tags', () => {
      const clean = sanitizeContentHtml('<p>Text</p><style>p{color:red}</style>');
      expect(clean).not.toMatch(/<style>/);
      expect(clean).toBe('<p>Text</p>');
    });

    it('allows img with src, alt, width, height, loading attributes', () => {
      const clean = sanitizeContentHtml(
        '<img src="https://example.com/pic.png" alt="A photo" width="800" height="600" loading="lazy">'
      );
      expect(clean).toContain('src="https://example.com/pic.png"');
      expect(clean).toContain('alt="A photo"');
    });

    it('allows tables with colspan/rowspan', () => {
      const input =
        '<table><thead><tr><th colspan="2">Header</th></tr></thead><tbody><tr><td rowspan="2">Cell</td><td>Data</td></tr></tbody></table>';
      const clean = sanitizeContentHtml(input);
      expect(clean).toContain('<table>');
      expect(clean).toContain('<th colspan="2"');
      expect(clean).toContain('<td rowspan="2"');
    });

    it('strips disallowed tags like div, span, iframe, form, input', () => {
      const dirty =
        '<div>Wrapper</div><span>Inline</span><iframe src="https://evil.com"></iframe><form><input type="text"></form>';
      const clean = sanitizeContentHtml(dirty);
      expect(clean).not.toMatch(/<div>/);
      expect(clean).not.toMatch(/<span>/);
      expect(clean).not.toMatch(/<iframe>/);
      expect(clean).not.toMatch(/<form>/);
      expect(clean).not.toMatch(/<input/);
      // Inner text is preserved
      expect(clean).toContain('Wrapper');
      expect(clean).toContain('Inline');
    });
  });

  describe('htmlToText (plain-text conversion for event descriptions)', () => {
    it('converts HTML to plain text with collapsed whitespace', () => {
      expect(htmlToText('<p>Hello   <b>world</b></p>')).toBe('Hello world');
    });

    it('handles nested HTML structures', () => {
      expect(
        htmlToText('<ul><li>Item <strong>one</strong></li><li>Item <em>two</em></li></ul>')
      ).toBe('Item oneItem two');
    });

    it('returns empty string for null input', () => {
      expect(htmlToText(null)).toBe('');
    });

    it('returns empty string for undefined input', () => {
      expect(htmlToText(undefined)).toBe('');
    });

    it('returns empty string for empty input', () => {
      expect(htmlToText('')).toBe('');
    });

    it('handles plain text with no HTML tags', () => {
      expect(htmlToText('Just plain text')).toBe('Just plain text');
    });
  });

  describe('excerptFromHtml', () => {
    it('returns full text when under word limit', () => {
      expect(excerptFromHtml('<p>short text</p>', 5)).toBe('short text');
    });

    it('truncates with ellipsis when over word limit', () => {
      const long = `<p>${Array.from({ length: 50 }, (_, i) => `word${i}`).join(' ')}</p>`;
      expect(excerptFromHtml(long, 5)).toBe('word0 word1 word2 word3 word4…');
    });
  });
});