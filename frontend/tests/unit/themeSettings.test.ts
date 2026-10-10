import { describe, expect, it } from 'vitest';
import { getPreset, settingsDefaults, validateSettings } from '@jump/theme';
import { fontStack, settingsVars } from '@/theme/settingsCss';
import { describeSaveError, describeSettingsError } from '@/theme/editor/errors';
import { newScheme, nextSchemeId, resetGroup, schemesOf, setSetting } from '@/theme/editor/settingsDraft';

const preset = getPreset('eventimus-default')!.settings;

describe('theme settings → CSS variables (spec 049 card C)', () => {
  it('maps typography to fonts, scales, case and letter spacing', () => {
    const vars = settingsVars({
      typography: { headingFont: 'playfair-display', bodyFont: 'system', headingScale: 120, bodyScale: 95, headingCase: 'uppercase', letterSpacing: 'wide' },
    });
    expect(vars['--font-heading']).toMatch(/^var\(--theme-font-playfair-display\), system-ui/);
    expect(vars['--font-body']).toMatch(/^system-ui/);
    expect(vars['--heading-scale']).toBe('1.2');
    expect(vars['--body-scale']).toBe('0.95');
    expect(vars['--heading-case']).toBe('uppercase');
    expect(vars['--letter-spacing']).toBe('0.05em');
  });

  it('falls back to the defaults and never passes text through', () => {
    const vars = settingsVars({ typography: { headingFont: 'x);}body{', headingScale: '200' as any, letterSpacing: 'evil' } });
    expect(vars['--font-heading']).not.toContain('}');
    expect(vars['--heading-scale']).toBe('1');
    expect(vars['--heading-case']).toBeUndefined();
    expect(vars['--letter-spacing']).toBe('normal');
    expect(settingsVars(settingsDefaults() as any)['--font-body']).toBe(fontStack('inter'));
  });
});

describe('theme settings draft', () => {
  it('sets one key and resets a whole group to the theme default', () => {
    const stored = setSetting({ logo: { desktopWidth: 200 } }, 'typography', 'headingFont', 'oswald');
    expect(stored).toEqual({ logo: { desktopWidth: 200 }, typography: { headingFont: 'oswald' } });
    expect(resetGroup(stored, 'typography')).toEqual({ logo: { desktopWidth: 200 } });
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
    expect(describeSettingsError('typography.headingFont', 'must be one of …')).toBe('Theme settings › Typography › Heading font: must be one of …');
  });
});
