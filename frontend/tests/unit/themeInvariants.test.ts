// Spec 038 invariants (plan §16 test 13, §9a.6): themed storefront sections
// take color only from brand / scheme tokens and neutral page tokens, and
// theme settings can only put numbers and #rrggbb colors into CSS.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { pageWidthVars, schemeCss, schemeClass, settingsVars } from '@/theme/settingsCss';
import { sectionWidthStyle } from '@/theme/sections/context';
import { secondaryCssVars } from '@/theme/ThemeScope';
import { faviconMetadata } from '@/lib/storefrontMeta';
import { bestForeground } from '@/lib/color';

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

  it('a template page width overrides the theme one; anything but a number is ignored', () => {
    expect(pageWidthVars({ props: { pageWidth: 1000 } })).toEqual({ '--theme-page-width': '1000px' });
    expect(pageWidthVars({ props: { pageWidth: '100vw' } })).toBeUndefined();
    expect(pageWidthVars(null)).toBeUndefined();
  });

  it('section width comes only from the enum', () => {
    expect(sectionWidthStyle({ sectionWidth: 'full' })).toEqual({ '--theme-section-width': 'none' });
    expect(sectionWidthStyle({ sectionWidth: 'narrow' })).toEqual({ '--theme-section-width': '768px' });
    expect(sectionWidthStyle({ sectionWidth: 'page' })).toEqual({});
    expect(sectionWidthStyle({ sectionWidth: '100vw;color:red' })).toEqual({});
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
    expect(css).toBe(`.jump-scheme-2{background-color:#111827;--brand:#FF0000;--brand-hover:#FF0000;--brand-link:#FF0000;--brand-fg:${bestForeground('#FF0000')}}`);
    expect(schemeClass('scheme-3')).toBe('jump-scheme-3');
    expect(schemeClass('scheme-9')).toBe('');
  });
});

describe('spec 049 brand secondary + favicon', () => {
  const scheme = { id: 'scheme-3', name: 'Alt', background: 'auto', foreground: 'auto', accent: 'brand-secondary', accentForeground: 'auto', secondaryButtonLabel: 'auto', border: 'auto', muted: 'auto', shadow: 'auto' };

  it('a brand-secondary accent points the brand tokens at the secondary vars', () => {
    expect(schemeCss({ colors: { schemes: [scheme] } } as any)).toBe(
      '.jump-scheme-3{--brand:var(--brand-secondary,#2563eb);--brand-hover:var(--brand-secondary-hover,#1d4ed8);--brand-fg:var(--brand-secondary-fg,#ffffff);--brand-link:var(--brand-secondary-link-light,#2563eb)}' +
        '.dark .jump-scheme-3{--brand-link:var(--brand-secondary-link-dark,#818cf8)}',
    );
    // Slots stored before the three-color rule are ignored.
    expect(schemeCss({ colors: { schemes: [{ ...scheme, accentForeground: '#000000', border: '#111111' }] } } as any)).not.toMatch(/#000000|#111111/);
  });

  it('secondary vars come from the secondary color, else the brand color, with a readable foreground', () => {
    expect(secondaryCssVars('#FFEE00', '#111111')).toMatchObject({ '--brand-secondary': '#ffee00', '--brand-secondary-fg': '#111827' });
    expect(secondaryCssVars(null, '#111111')).toMatchObject({ '--brand-secondary': '#111111', '--brand-secondary-fg': '#ffffff' });
    expect(secondaryCssVars('nope', null)).toBeUndefined();
  });

  it('favicon metadata: the resolved URL as icon and apple icon, or nothing', () => {
    expect(faviconMetadata('https://api.test/files/f1/h1/icon.png').icons).toEqual({ icon: 'https://api.test/files/f1/h1/icon.png', apple: 'https://api.test/files/f1/h1/icon.png' });
    expect(faviconMetadata(null)).toEqual({});
  });
});
