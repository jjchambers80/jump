// Plain-text-to-HTML conversion (event description backfill helper).
// Tests: empty string, single paragraph, multiple paragraphs,
// single newline within paragraph, trailing newlines, mixed newlines,
// HTML entities, null/undefined.

import { plainToHtml } from '../../src/utils/plainToHtml.js';

describe('plainToHtml', () => {
  describe('edge inputs', () => {
    it('returns empty string for null', () => {
      expect(plainToHtml(null)).toBe('');
    });

    it('returns empty string for undefined', () => {
      expect(plainToHtml(undefined)).toBe('');
    });

    it('returns empty string for empty string', () => {
      expect(plainToHtml('')).toBe('');
    });

    it('returns empty string for whitespace-only string', () => {
      expect(plainToHtml('   \n\n  ')).toBe('');
    });
  });

  describe('single paragraph', () => {
    it('wraps a single line in <p>', () => {
      expect(plainToHtml('Hello, world!')).toBe('<p>Hello, world!</p>');
    });

    it('trims trailing spaces from each line', () => {
      expect(plainToHtml('Hello   \nworld  ')).toBe('<p>Hello<br>world</p>');
    });
  });

  describe('single newline within paragraph', () => {
    it('replaces single newline with <br>', () => {
      expect(plainToHtml('Line one\nLine two')).toBe('<p>Line one<br>Line two</p>');
    });

    it('handles multiple single newlines', () => {
      expect(plainToHtml('A\nB\nC')).toBe('<p>A<br>B<br>C</p>');
    });
  });

  describe('multiple paragraphs', () => {
    it('splits on blank line (two newlines)', () => {
      expect(plainToHtml('First paragraph\n\nSecond paragraph')).toBe(
        '<p>First paragraph</p>\n<p>Second paragraph</p>'
      );
    });

    it('splits on three or more consecutive newlines', () => {
      expect(plainToHtml('One\n\n\nTwo\n\n\n\nThree')).toBe(
        '<p>One</p>\n<p>Two</p>\n<p>Three</p>'
      );
    });

    it('handles mixed inline breaks and paragraph breaks', () => {
      const input = 'Line 1a\nLine 1b\n\nLine 2a\nLine 2b\nLine 2c\n\nLine 3a';
      const expected =
        '<p>Line 1a<br>Line 1b</p>\n<p>Line 2a<br>Line 2b<br>Line 2c</p>\n<p>Line 3a</p>';
      expect(plainToHtml(input)).toBe(expected);
    });
  });

  describe('trailing and leading newlines', () => {
    it('ignores trailing blank line', () => {
      const input = 'Hello\n\nWorld\n\n';
      expect(plainToHtml(input)).toBe(
        '<p>Hello</p>\n<p>World</p>'
      );
    });

    it('ignores leading blank lines', () => {
      const input = '\n\nHello\n\nWorld';
      expect(plainToHtml(input)).toBe(
        '<p>Hello</p>\n<p>World</p>'
      );
    });

    it('ignores leading and trailing blank lines', () => {
      const input = '\n\nHello\n\nWorld\n\n';
      expect(plainToHtml(input)).toBe(
        '<p>Hello</p>\n<p>World</p>'
      );
    });
  });

  describe('HTML entity escaping', () => {
    it('escapes <', () => {
      expect(plainToHtml('x < y')).toBe('<p>x &lt; y</p>');
    });

    it('escapes >', () => {
      expect(plainToHtml('a > b')).toBe('<p>a &gt; b</p>');
    });

    it('escapes &', () => {
      expect(plainToHtml('this & that')).toBe('<p>this &amp; that</p>');
    });

    it('escapes quotes', () => {
      expect(plainToHtml('he said "hi"')).toBe('<p>he said &quot;hi&quot;</p>');
    });

    it('escapes apostrophes', () => {
      expect(plainToHtml("it's fine")).toBe('<p>it&#39;s fine</p>');
    });

    it('escapes mixed entities across paragraphs', () => {
      const input = '<script>alert("x")</script>\n\nNormal &amp; text';
      const expected =
        '<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</p>\n<p>Normal &amp;amp; text</p>';
      expect(plainToHtml(input)).toBe(expected);
    });
  });

  describe('carriage return handling', () => {
    it('normalises CRLF to LF', () => {
      expect(plainToHtml('Hello\r\n\r\nWorld')).toBe(
        '<p>Hello</p>\n<p>World</p>'
      );
    });

    it('normalises bare CR to LF', () => {
      expect(plainToHtml('Hello\r\rWorld')).toBe(
        '<p>Hello</p>\n<p>World</p>'
      );
    });
  });
});