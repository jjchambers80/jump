// Pure color utilities for organization brand colors.
// WCAG 2.1 relative luminance / contrast ratio math, hover + dark-mode derivation,
// and the CSS custom property payload consumed by BrandScope. No React here.

export const WCAG_AA_NORMAL = 4.5;

/** Page backgrounds from globals.css (--background in :root / .dark). */
export const LIGHT_PAGE_BG = '#f9fafb';
export const DARK_PAGE_BG = '#0f172a';

/** Platform defaults — must match today's bg-blue-600 / text-blue-600 / dark:text-indigo-400. */
export const BRAND_DEFAULTS = {
  brand: '#2563eb',
  hover: '#1d4ed8',
  fg: '#ffffff',
  linkLight: '#2563eb',
  linkDark: '#818cf8',
} as const;

const DARK_TEXT = '#111827';
const WHITE = '#ffffff';

export interface BrandPreset {
  name: string;
  hex: string;
}

/** Tailwind 700/800 shades that pass AA for white text and as link text on the light page bg. */
export const BRAND_PRESETS: BrandPreset[] = [
  { name: 'Blue', hex: '#1d4ed8' },
  { name: 'Indigo', hex: '#4338ca' },
  { name: 'Violet', hex: '#6d28d9' },
  { name: 'Pink', hex: '#be185d' },
  { name: 'Rose', hex: '#be123c' },
  { name: 'Red', hex: '#b91c1c' },
  { name: 'Orange', hex: '#c2410c' },
  { name: 'Green', hex: '#15803d' },
  { name: 'Emerald', hex: '#047857' },
  { name: 'Teal', hex: '#0f766e' },
  { name: 'Sky', hex: '#075985' },
  { name: 'Slate', hex: '#1e293b' },
];

const HEX_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Normalize user input to lowercase #rrggbb. Returns null when not a valid hex color. */
export function normalizeHex(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null;
  const match = input.trim().match(HEX_PATTERN);
  if (!match) return null;
  let hex = match[1].toLowerCase();
  if (hex.length === 3) {
    hex = hex
      .split('')
      .map((c) => c + c)
      .join('');
  }
  return `#${hex}`;
}

export function hexToRgb(hex: string): [number, number, number] {
  const normalized = normalizeHex(hex);
  if (!normalized) throw new Error(`Invalid hex color: ${hex}`);
  const value = parseInt(normalized.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export function rgbToHex([r, g, b]: [number, number, number]): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return `#${[r, g, b].map((c) => clamp(c).toString(16).padStart(2, '0')).join('')}`;
}

function linearize(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG 2.1 relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/** WCAG 2.1 contrast ratio between two colors, 1 to 21. Order does not matter. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Pick white or near-black text, whichever contrasts more with the background. */
export function bestForeground(bg: string): string {
  return contrastRatio(bg, WHITE) >= contrastRatio(bg, DARK_TEXT) ? WHITE : DARK_TEXT;
}

/** Mix a color toward black by `pct` (0–100). */
export function shade(hex: string, pct: number): string {
  const [r, g, b] = hexToRgb(hex);
  const f = 1 - pct / 100;
  return rgbToHex([r * f, g * f, b * f]);
}

/** Mix a color toward white by `pct` (0–100). */
export function tint(hex: string, pct: number): string {
  const [r, g, b] = hexToRgb(hex);
  const f = pct / 100;
  return rgbToHex([r + (255 - r) * f, g + (255 - g) * f, b + (255 - b) * f]);
}

/**
 * Lighten `start` in small steps toward white until it reaches `target` contrast on `bg`.
 * Used to derive a dark-mode link color from a brand color chosen for light backgrounds.
 * Returns the first passing color, or white if nothing passes (white always contrasts most).
 */
export function deriveAccessibleOn(bg: string, start: string, target = WCAG_AA_NORMAL): string {
  const base = normalizeHex(start) ?? BRAND_DEFAULTS.brand;
  if (contrastRatio(base, bg) >= target) return base;
  for (let pct = 5; pct <= 100; pct += 5) {
    const candidate = tint(base, pct);
    if (contrastRatio(candidate, bg) >= target) return candidate;
  }
  return WHITE;
}

export interface ContrastCheck {
  ratio: number;
  passes: boolean;
  fg: string;
  bg: string;
}

export interface BrandEvaluation {
  hex: string;
  buttonText: ContrastCheck;
  linkLight: ContrastCheck;
  linkDark: ContrastCheck;
  passesAA: boolean;
}

function check(fg: string, bg: string): ContrastCheck {
  const ratio = contrastRatio(fg, bg);
  return { ratio, passes: ratio >= WCAG_AA_NORMAL, fg, bg };
}

/**
 * Evaluate a brand color against the three places it is used:
 * button text on the brand background, link text on the light page, and the
 * derived dark-mode link tint on the dark page. `passesAA` requires all three ≥ 4.5:1.
 */
export function evaluateBrandColor(input: string): BrandEvaluation {
  const hex = normalizeHex(input) ?? BRAND_DEFAULTS.brand;
  const buttonText = check(bestForeground(hex), hex);
  const linkLight = check(hex, LIGHT_PAGE_BG);
  const linkDark = check(deriveAccessibleOn(DARK_PAGE_BG, hex), DARK_PAGE_BG);
  return {
    hex,
    buttonText,
    linkLight,
    linkDark,
    passesAA: buttonText.passes && linkLight.passes && linkDark.passes,
  };
}

export type BrandCssVars = Record<
  '--brand' | '--brand-hover' | '--brand-fg' | '--brand-link-light' | '--brand-link-dark',
  string
>;

/**
 * Inline style payload for BrandScope. Returns undefined for null/invalid input so
 * pages without a brand color fall through to the platform defaults in globals.css.
 */
export function brandCssVars(input: string | null | undefined): BrandCssVars | undefined {
  const hex = normalizeHex(input);
  if (!hex) return undefined;
  return {
    '--brand': hex,
    '--brand-hover': shade(hex, 12),
    '--brand-fg': bestForeground(hex),
    '--brand-link-light': hex,
    '--brand-link-dark': deriveAccessibleOn(DARK_PAGE_BG, hex),
  };
}

/** Format a ratio for display, e.g. 6.7 → "6.70:1". */
export function formatRatio(ratio: number): string {
  return `${ratio.toFixed(2)}:1`;
}
