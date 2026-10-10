import { describe, expect, it } from 'vitest';
import { getPreset, mobileLogoWidth, normalizeLogo, normalizeTypography, resolveSettings, settingsDefaults, validateSettings } from '@jump/theme';
import { fontStack, settingsVars } from '@/theme/settingsCss';
import { describeSaveError, describeSettingsError } from '@/theme/editor/errors';
import { newScheme, nextSchemeId, resetGroup, schemesOf, setSetting } from '@/theme/editor/settingsDraft';

const preset = getPreset('eventimus-default')!.settings;

describe('theme settings → CSS variables (spec 049 card C)', () => {
  it('maps the one theme font to --theme-font', () => {
    expect(settingsVars({ typography: { font: 'playfair-display' } })['--theme-font']).toMatch(/^var\(--theme-font-playfair-display\), system-ui/);
    expect(settingsVars({ typography: { font: 'system' } })['--theme-font']).toMatch(/^system-ui/);
  });

  it('falls back to the default and never passes text through', () => {
    expect(settingsVars({ typography: { font: 'x);}body{' } })['--theme-font']).not.toContain('}');
    expect(settingsVars(settingsDefaults() as any)['--theme-font']).toBe(fontStack('inter'));
  });

  it('one logo size: old desktop width folds in, mobile width and favicon drop, phones get 3/4', () => {
    expect(normalizeLogo({ desktopWidth: 180, mobileWidth: 110, favicon: { fileId: 'f' } })).toEqual({ width: 180 });
    expect(validateSettings({ logo: { desktopWidth: 180, favicon: { fileId: 'f' } } })).toEqual({ value: { logo: { width: 180 } }, errors: {} });
    expect(settingsVars({ logo: { width: 200 } })).toMatchObject({ '--theme-logo-width': '200px', '--theme-logo-width-mobile': '150px' });
    expect(settingsVars({})).toMatchObject({ '--theme-logo-width': '120px', '--theme-logo-width-mobile': '90px' });
    expect(mobileLogoWidth(50)).toBe(38);
  });

  it('folds the old heading/body keys into the one font', () => {
    const old = { headingFont: 'oswald', bodyFont: 'lora', headingScale: 120, headingCase: 'uppercase', letterSpacing: 'wide' };
    expect(normalizeTypography(old)).toEqual({ font: 'lora' });
    expect(normalizeTypography({ headingFont: 'oswald' })).toEqual({ font: 'oswald' });
    expect(validateSettings({ typography: old })).toEqual({ value: { typography: { font: 'lora' } }, errors: {} });
    expect((resolveSettings({ typography: { headingFont: 'oswald' } }, preset) as any).typography).toEqual({ font: 'oswald' });
  });
});

describe('theme settings draft', () => {
  it('sets one key and resets a whole group to the theme default', () => {
    const stored = setSetting({ logo: { width: 200 } }, 'typography', 'font', 'oswald');
    expect(stored).toEqual({ logo: { width: 200 }, typography: { font: 'oswald' } });
    expect(resetGroup(stored, 'typography')).toEqual({ logo: { width: 200 } });
  });

  it('adds and duplicates schemes with free ids, valid for the server', () => {
    const schemes = schemesOf({}, preset);
    expect(schemes.map((s) => s.id)).toEqual(['scheme-1', 'scheme-2']);
    const id = nextSchemeId(schemes)!;
    expect(id).toBe('scheme-3');
    const next = [...schemes, newScheme(id, schemes[1])];
    expect(next[2]).toMatchObject({ id: 'scheme-3', name: 'Inverse copy', background: '#111827' });
    expect(validateSettings({ colors: { schemes: next } }).errors).toEqual({});
    expect(nextSchemeId(Array.from({ length: 8 }, (_, i) => ({ id: `scheme-${i + 1}` })))).toBeNull();
  });
});

describe('settings error messages', () => {
  const settings = { colors: { schemes: [{ id: 'scheme-1', name: 'Page' }] } };
  it('names the scheme and the slot', () => {
    expect(describeSaveError('colors.schemes[0].accent', 'must be a #rrggbb color or "brand"', {}, settings)).toBe(
      'Theme settings › Colors › Page › Accent: must be a #rrggbb color or "brand"',
    );
  });
  it('names the group and field', () => {
    expect(describeSettingsError('typography.font', 'must be one of …')).toBe('Theme settings › Typography › Font: must be one of …');
  });
});
