import { describe, expect, it } from 'vitest';
import {
  BRAND_DEFAULTS,
  BRAND_PRESETS,
  DARK_PAGE_BG,
  LIGHT_PAGE_BG,
  bestForeground,
  brandCssVars,
  contrastRatio,
  deriveAccessibleOn,
  evaluateBrandColor,
  formatRatio,
  normalizeHex,
  relativeLuminance,
  shade,
  tint,
} from '@/lib/color';

describe('normalizeHex', () => {
  it('lowercases and keeps 6-digit hex', () => {
    expect(normalizeHex('#1D4ED8')).toBe('#1d4ed8');
  });

  it('expands 3-digit hex', () => {
    expect(normalizeHex('#abc')).toBe('#aabbcc');
  });

  it('accepts a missing leading hash and surrounding whitespace', () => {
    expect(normalizeHex(' 1d4ed8 ')).toBe('#1d4ed8');
  });

  it.each(['red', '#ggg', '#12345', '', null, undefined])('returns null for %p', (value) => {
    expect(normalizeHex(value as string | null | undefined)).toBeNull();
  });
});

describe('contrast math', () => {
  it('computes relative luminance of black and white', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5);
  });

  it('computes 21:1 between black and white', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
  });

  it.each([
    ['#1d4ed8', 6.7, 6.41, 2.66],
    ['#4338ca', 7.9, 7.56, 2.26],
    ['#047857', 5.48, 5.25, 3.26],
    ['#c2410c', 5.18, 4.96, 3.45],
    ['#2563eb', 5.17, 4.95, 3.45],
  ])('matches the plan table for %s', (hex, white, light, dark) => {
    expect(contrastRatio(hex, '#ffffff')).toBeCloseTo(white, 1);
    expect(contrastRatio(hex, LIGHT_PAGE_BG)).toBeCloseTo(light, 1);
    expect(contrastRatio(hex, DARK_PAGE_BG)).toBeCloseTo(dark, 1);
  });
});

describe('bestForeground', () => {
  it('picks white on dark brand colors', () => {
    expect(bestForeground('#1d4ed8')).toBe('#ffffff');
  });

  it('picks dark text on light brand colors', () => {
    expect(bestForeground('#ffff00')).toBe('#111827');
  });
});

describe('shade / tint', () => {
  it('shade moves toward black', () => {
    expect(shade('#ffffff', 50)).toBe('#808080');
    expect(shade('#1d4ed8', 0)).toBe('#1d4ed8');
  });

  it('tint moves toward white', () => {
    expect(tint('#000000', 50)).toBe('#808080');
    expect(tint('#1d4ed8', 100)).toBe('#ffffff');
  });
});

describe('deriveAccessibleOn', () => {
  it('returns the start color when it already passes', () => {
    expect(deriveAccessibleOn('#ffffff', '#1d4ed8')).toBe('#1d4ed8');
  });

  it('lightens until it passes 4.5:1 on the dark page background', () => {
    for (const { hex } of BRAND_PRESETS) {
      const derived = deriveAccessibleOn(DARK_PAGE_BG, hex);
      expect(contrastRatio(derived, DARK_PAGE_BG)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('evaluateBrandColor', () => {
  it('passes AA for every preset', () => {
    for (const { hex } of BRAND_PRESETS) {
      const result = evaluateBrandColor(hex);
      expect(result.passesAA, `${hex} should pass`).toBe(true);
      expect(result.buttonText.ratio).toBeGreaterThanOrEqual(4.5);
      expect(result.linkLight.ratio).toBeGreaterThanOrEqual(4.5);
      expect(result.linkDark.ratio).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('fails AA for a pale color that cannot be a link on the light page', () => {
    const result = evaluateBrandColor('#ffff00');
    expect(result.passesAA).toBe(false);
    expect(result.linkLight.passes).toBe(false);
    expect(result.buttonText.fg).toBe('#111827');
  });

  it('reports each check with fg/bg pairs', () => {
    const result = evaluateBrandColor('#1d4ed8');
    expect(result.buttonText).toMatchObject({ fg: '#ffffff', bg: '#1d4ed8', passes: true });
    expect(result.linkLight).toMatchObject({ fg: '#1d4ed8', bg: LIGHT_PAGE_BG, passes: true });
    expect(result.linkDark.bg).toBe(DARK_PAGE_BG);
  });
});

describe('brandCssVars', () => {
  it('returns undefined for null or invalid input', () => {
    expect(brandCssVars(null)).toBeUndefined();
    expect(brandCssVars('nope')).toBeUndefined();
  });

  it('derives every variable from one hex', () => {
    const vars = brandCssVars('#1D4ED8');
    expect(vars).toBeDefined();
    expect(vars!['--brand']).toBe('#1d4ed8');
    expect(vars!['--brand-link-light']).toBe('#1d4ed8');
    expect(vars!['--brand-fg']).toBe('#ffffff');
    expect(contrastRatio(vars!['--brand-hover'], '#ffffff')).toBeGreaterThan(
      contrastRatio('#1d4ed8', '#ffffff')
    );
    expect(contrastRatio(vars!['--brand-link-dark'], DARK_PAGE_BG)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('defaults', () => {
  it('default link-dark passes AA on the dark page background', () => {
    expect(contrastRatio(BRAND_DEFAULTS.linkDark, DARK_PAGE_BG)).toBeGreaterThanOrEqual(4.5);
  });

  it('formats ratios to two decimals', () => {
    expect(formatRatio(6.7012)).toBe('6.70:1');
  });
});
