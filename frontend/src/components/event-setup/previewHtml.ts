// The unsaved description, as the preview frame renders it while the organizer
// types (spec 050 §8.3). Stored HTML is sanitised on write by the backend
// (gotcha 20); this text has not reached the server yet, so the frame cleans
// it here with the same allowlist (backend/src/utils/sanitizeHtml.js) before
// ContentHtml sees it. The save replaces it with the server's copy.

import DOMPurify from 'dompurify';
import { videoEmbedSrc } from '@/lib/videoEmbed';

const TAGS = [
  'p', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'blockquote', 'a', 'img', 'strong', 'b', 'em', 'i', 'u', 's',
  'br', 'hr', 'pre', 'code', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'figure', 'figcaption', 'iframe',
];
const ATTRS = ['href', 'title', 'target', 'rel', 'src', 'alt', 'width', 'height', 'loading', 'colspan', 'rowspan'];

let hooked = false;
function hook() {
  if (hooked) return;
  hooked = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    const el = node as Element;
    if (el.tagName === 'IFRAME') {
      // YouTube / Vimeo players only, rewritten to the canonical URL.
      const src = videoEmbedSrc(el.getAttribute('src') ?? '');
      if (!src) return el.remove();
      for (const name of el.getAttributeNames()) el.removeAttribute(name);
      el.setAttribute('src', src);
      el.setAttribute('class', 'jump-video');
      el.setAttribute('title', 'Embedded video');
      return;
    }
    if (el.tagName === 'A') {
      if (el.getAttribute('target') === '_blank') el.setAttribute('rel', 'noopener');
      else el.removeAttribute('target');
    }
  });
}

export function sanitizePreviewHtml(html: string): string {
  hook();
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: TAGS,
    ALLOWED_ATTR: ATTRS,
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:)/i,
  }).trim();
}
