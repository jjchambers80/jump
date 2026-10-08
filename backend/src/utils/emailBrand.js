// Organization brand color for emails. Same WCAG math as the storefront's
// frontend/src/lib/color.ts (normalizeHex, contrastRatio, bestForeground), so
// a store's emails match its pages. Email bodies are white, so links use the
// brand darkened until it reaches 4.5:1 on white; buttons use the brand as is
// with whichever of white / near-black text contrasts more.

const DEFAULT_BRAND = '#2563eb';
const WHITE = '#ffffff';
const DARK_TEXT = '#111827';
const AA = 4.5;

export function normalizeHex(input) {
  if (typeof input !== 'string') return null;
  const match = input.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return null;
  let hex = match[1].toLowerCase();
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  return `#${hex}`;
}

function rgb(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function luminance(hex) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = rgb(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function shade(hex, pct) {
  const f = 1 - pct / 100;
  return `#${rgb(hex).map((c) => Math.round(c * f).toString(16).padStart(2, '0')).join('')}`;
}

/** { brand, onBrand, link } for an organization's brandColor (platform blue when unset/invalid). */
export function emailBrand(brandColor) {
  const brand = normalizeHex(brandColor) || DEFAULT_BRAND;
  const onBrand = contrastRatio(brand, WHITE) >= contrastRatio(brand, DARK_TEXT) ? WHITE : DARK_TEXT;
  let link = brand;
  for (let pct = 5; contrastRatio(link, WHITE) < AA && pct <= 100; pct += 5) link = shade(brand, pct);
  return { brand, onBrand, link };
}
