// Server-side sanitiser for organizer-authored HTML (blog posts, excerpts,
// pages). This is the trust boundary: the storefront renders stored HTML
// as-is, so everything must be cleaned on write.

import sanitize from 'sanitize-html';

export const CONTENT_HTML = {
  allowedTags: [
    'p',
    'h2',
    'h3',
    'h4',
    'ul',
    'ol',
    'li',
    'blockquote',
    'a',
    'img',
    'strong',
    'b',
    'em',
    'i',
    'u',
    's',
    'br',
    'hr',
    'pre',
    'code',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
    'figure',
    'figcaption',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'width', 'height', 'loading'],
    td: ['colspan', 'rowspan'],
    th: ['colspan', 'rowspan'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: { img: ['http', 'https'] },
  allowProtocolRelative: false,
  transformTags: {
    // The page title owns h1; demote pasted headings.
    h1: 'h2',
    a: (tagName, attribs) => {
      const next = { ...attribs };
      if (next.target === '_blank') next.rel = 'noopener';
      else delete next.target;
      return { tagName, attribs: next };
    },
  },
};

export function sanitizeContentHtml(html) {
  if (typeof html !== 'string') return '';
  return sanitize(html, CONTENT_HTML).trim();
}

/** Plain text of sanitised HTML — for excerpts and meta descriptions. */
export function htmlToText(html) {
  return sanitize(String(html || ''), { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, ' ')
    .trim();
}

/** First `words` words of the text, with an ellipsis when cut. */
export function excerptFromHtml(html, words = 40) {
  const text = htmlToText(html);
  const parts = text.split(' ').filter(Boolean);
  if (parts.length <= words) return text;
  return `${parts.slice(0, words).join(' ')}…`;
}
