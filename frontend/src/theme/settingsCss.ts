// Theme settings → CSS (spec 038 §6.3). Every value is range-checked by the
// backend; numbers are re-checked here so nothing but a number or a #rrggbb
// color can reach a style. Card 038F wires the remaining groups; spec 049
// card C adds typography (fonts come from theme/fonts.ts).

import { BRAND_DEFAULTS } from '@/lib/color';
import type { ThemeSettings } from './types';

const HEX = /^#[0-9a-f]{6}$/i;
const num = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

const SYSTEM_STACK = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const FONT_KEY = /^[a-z][a-z-]{1,30}$/;
const LETTER_SPACING: Record<string, string> = { tight: '-0.02em', normal: 'normal', wide: '0.05em' };

/** A FONTS key → font-family. `--theme-font-<key>` is set by the font's class (theme/fonts.ts). */
export function fontStack(key: unknown): string {
  return typeof key === 'string' && key !== 'system' && FONT_KEY.test(key) ? `var(--theme-font-${key}), ${SYSTEM_STACK}` : SYSTEM_STACK;
}

export function settingsVars(settings: ThemeSettings): Record<string, string> {
  const layout = settings.layout ?? {};
  const logo = settings.logo ?? {};
  const buttons = settings.buttons ?? {};
  const type = settings.typography ?? {};
  const radius = buttons.shape === 'pill' ? 9999 : buttons.shape === 'square' ? 0 : num(buttons.radius, 8);
  return {
    '--theme-page-width': `${num(layout.pageWidth, 1280)}px`,
    '--theme-section-gap': `${num(layout.sectionSpacing, 0)}px`,
    '--theme-logo-width': `${num(logo.desktopWidth, 120)}px`,
    '--theme-logo-width-mobile': `${num(logo.mobileWidth, 90)}px`,
    '--theme-button-radius': `${radius}px`,
    '--font-heading': fontStack(type.headingFont ?? 'inter'),
    '--font-body': fontStack(type.bodyFont ?? 'inter'),
    '--heading-scale': String(num(type.headingScale, 100) / 100),
    '--body-scale': String(num(type.bodyScale, 100) / 100),
    '--letter-spacing': LETTER_SPACING[type.letterSpacing] ?? 'normal',
    // Unset for "as typed": text-transform then inherits (globals.css).
    ...(type.headingCase === 'uppercase' ? { '--heading-case': 'uppercase' } : {}),
  };
}

/**
 * `.jump-scheme-N` classes for schemes with explicit colors. `auto` slots set
 * nothing, so they follow the page's light/dark tokens (D7); `brand` accent
 * keeps the brand variables from BrandScope; `brand-secondary` swaps in the
 * org secondary color (ThemeScope `--brand-secondary-*`).
 */
/** A template's own page width (root.props.pageWidth) over the theme's, for its whole frame. */
export function pageWidthVars(root: { props?: Record<string, unknown> } | null | undefined): Record<string, string> | undefined {
  const width = root?.props?.pageWidth;
  return typeof width === 'number' && Number.isFinite(width) ? { '--theme-page-width': `${width}px` } : undefined;
}

const SECONDARY_DECL = [
  `--brand:var(--brand-secondary,${BRAND_DEFAULTS.brand})`,
  `--brand-hover:var(--brand-secondary-hover,${BRAND_DEFAULTS.hover})`,
  `--brand-fg:var(--brand-secondary-fg,${BRAND_DEFAULTS.fg})`,
  `--brand-link:var(--brand-secondary-link-light,${BRAND_DEFAULTS.linkLight})`,
];

export function schemeCss(settings: ThemeSettings): string | null {
  const rules: string[] = [];
  for (const scheme of settings.colors?.schemes ?? []) {
    if (!/^scheme-[1-8]$/.test(scheme.id)) continue;
    const decl: string[] = [];
    if (HEX.test(scheme.background)) decl.push(`background-color:${scheme.background}`);
    if (HEX.test(scheme.foreground)) decl.push(`color:${scheme.foreground}`, `--foreground:${scheme.foreground}`);
    if (HEX.test(scheme.accent)) decl.push(`--brand:${scheme.accent}`, `--brand-hover:${scheme.accent}`, `--brand-link:${scheme.accent}`);
    // Spec 049: the org secondary color, from ThemeScope's --brand-secondary-* vars.
    const secondary = scheme.accent === 'brand-secondary';
    if (secondary) decl.push(...SECONDARY_DECL);
    if (HEX.test(scheme.accentForeground)) decl.push(`--brand-fg:${scheme.accentForeground}`);
    if (HEX.test(scheme.border)) decl.push(`--scheme-border:${scheme.border}`);
    if (decl.length) rules.push(`.jump-${scheme.id}{${decl.join(';')}}`);
    if (secondary) rules.push(`.dark .jump-${scheme.id}{--brand-link:var(--brand-secondary-link-dark,${BRAND_DEFAULTS.linkDark})}`);
  }
  return rules.length ? rules.join('') : null;
}

export function schemeClass(id: unknown): string {
  return typeof id === 'string' && /^scheme-[1-8]$/.test(id) ? `jump-${id}` : '';
}
