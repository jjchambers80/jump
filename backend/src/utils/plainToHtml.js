// Plain-text to HTML converter.
// Escapes HTML entities and wraps paragraphs (<p>) separated by blank lines,
// with <br> for single newlines within a paragraph.
// Safe to pass through sanitizeContentHtml — the output contains only
// allowed tags (p, br) and fully-escaped text content.
//
// Usage:
//   import { plainToHtml } from '../utils/plainToHtml.js';
//   plainToHtml("Hello\nWorld\n\nSecond paragraph");

/**
 * Escape HTML entities in text content.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Convert plain text with newlines to HTML.
 *
 * - Blank lines (two or more consecutive newlines) separate <p>...</p> blocks.
 * - Single newlines within a block become <br>.
 * - All HTML entities are escaped before wrapping.
 * - The result is safe to run through sanitizeContentHtml without double-escaping.
 *
 * @param {string|null|undefined} text - Plain text to convert
 * @returns {string} HTML string, or '' for falsy/empty input
 */
export function plainToHtml(text) {
  if (typeof text !== 'string' || text.trim() === '') return '';

  // Normalise line endings
  const normalized = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Escape HTML entities first so <, >, & in the original text never become tags
  const escaped = escapeHtml(normalized);

  // Split on blank lines (two or more consecutive newlines)
  const blocks = escaped.split(/\n\n+/);

  // Filter out blocks that are only whitespace (leading/trailing blank lines)
  const nonEmpty = blocks.filter((b) => b.trim().length > 0);

  if (nonEmpty.length === 0) return '';

  return nonEmpty
    .map((block) => {
      // Within a block, replace single newlines with <br>
      const withBreaks = block.split('\n').map((line) => line.trimEnd()).join('<br>');
      return `<p>${withBreaks}</p>`;
    })
    .join('\n');
}