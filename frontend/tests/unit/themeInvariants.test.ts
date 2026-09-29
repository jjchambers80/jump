// Spec 038 invariants (plan §16 test 13, §9a.6): themed storefront sections
// take color only from brand / scheme tokens and neutral page tokens, and
// theme settings can only put numbers and #rrggbb colors into CSS.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { schemeCss, schemeClass, settingsVars } from '@/theme/settingsCss';

const SECTIONS_DIR = path.join(__dirname, '../../src/theme/sections');
// Chromatic Tailwind palettes: a raw `bg-blue-600` would ignore the org's brand.
const RAW_COLOR = /\b(?:bg|text|border|ring|from|via|to|fill|stroke|outline|decoration|divide|shadow)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/;

describe('theme sections use color tokens only', () => {
  for (const file of readdirSync(SECTIONS_DIR).filter((f) => f.endsWith('.tsx'))) {
    it(file, () => {
      const source = readFileSync(path.join(SECTIONS_DIR, file), 'utf8');
      expect(source.match(RAW_COLOR)?.[0] ?? null).toBeNull();
    });
  }
});

describe('settings → CSS', () => {
  it('maps settings to variables and falls back on anything that is not a number', () => {
    const vars = settingsVars({ layout: { pageWidth: 1300, sectionSpacing: '10px;background:red' }, buttons: { shape: 'pill' } } as any);
    expect(vars['--theme-page-width']).toBe('1300px');
    expect(vars['--theme-section-gap']).toBe('0px');
    expect(vars['--theme-button-radius']).toBe('9999px');
  });

  it('emits scheme classes only for #rrggbb values and valid ids', () => {
    const css = schemeCss({
      colors: {
        schemes: [
          { id: 'scheme-1', name: 'Page', background: 'auto', foreground: 'auto', accent: 'brand', accentForeground: 'auto', secondaryButtonLabel: 'auto', border: 'auto', muted: 'auto', shadow: 'auto' },
          { id: 'scheme-2', name: 'Dark', background: '#111827', foreground: 'red;}body{display:none', accent: '#FF0000', accentForeground: 'auto', secondaryButtonLabel: 'auto', border: 'auto', muted: 'auto', shadow: 'auto' },
          { id: 'x}body{', name: 'Bad', background: '#000000' } as any,
        ],
      },
    } as any);
    expect(css).toBe('.jump-scheme-2{background-color:#111827;--brand:#FF0000;--brand-hover:#FF0000;--brand-link:#FF0000}');
    expect(schemeClass('scheme-3')).toBe('jump-scheme-3');
    expect(schemeClass('scheme-9')).toBe('');
  });
});
