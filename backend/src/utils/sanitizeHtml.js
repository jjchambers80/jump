// Server-side sanitiser for organizer-authored HTML (blog posts, excerpts,
// pages). This is the trust boundary: the storefront renders stored HTML
// as-is, so everything must be cleaned on write.

import sanitize from 'sanitize-html';
import { VIDEO_EMBED_ALLOW, VIDEO_EMBED_HOSTS, videoEmbedSrc } from './videoEmbed.js';

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
    'iframe',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'width', 'height', 'loading'],
    td: ['colspan', 'rowspan'],
    th: ['colspan', 'rowspan'],
    iframe: ['src', 'title', 'class', 'loading', 'allow', 'allowfullscreen', 'referrerpolicy'],
  },
  allowedClasses: { iframe: ['jump-video'] },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: { img: ['http', 'https'], iframe: ['https'] },
  // Video embeds (the editor's Insert video): the iframe transform below
  // rewrites src to a canonical YouTube / Vimeo player URL; the host list is
  // the second lock.
  allowedIframeHostnames: VIDEO_EMBED_HOSTS,
  allowIframeRelativeUrls: false,
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
    iframe: (tagName, attribs) => {
      const src = videoEmbedSrc(attribs.src);
      if (!src) return { tagName, attribs: {} };
      return {
        tagName,
        attribs: {
          src,
          title: attribs.title?.trim() || 'Embedded video',
          class: 'jump-video',
          loading: 'lazy',
          allow: VIDEO_EMBED_ALLOW,
          allowfullscreen: '',
          referrerpolicy: 'strict-origin-when-cross-origin',
        },
      };
    },
  },
  // An iframe that is not a YouTube / Vimeo player loses its src above; drop
  // it (and anything nested in it) entirely.
  exclusiveFilter: (frame) => frame.tag === 'iframe' && !frame.attribs.src,
  // Fallback text inside a kept player never renders; don't store it.
  textFilter: (text, tagName) => (tagName === 'iframe' ? '' : text),
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
