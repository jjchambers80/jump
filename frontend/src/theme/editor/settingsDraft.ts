// Stored theme settings edits for the gear panel (spec 049 card C). The
// stored value is partial: a missing group or key means "theme default", so
// reset removes rather than writes defaults.

import { COLOR_SCHEMES_MAX } from '@jump/theme';
import type { ThemeScheme, ThemeSettings } from '../types';

export type StoredSettings = Record<string, any>;

/** The panel's groups, in order (the rest of §6.3 is card 038F F2). */
export const PANEL_GROUPS = ['logo', 'colors', 'typography'] as const;

/** Accent options besides a hex color. Spec 049 card A adds 'brand-secondary' here. */
export const ACCENT_SPECIALS = ['brand', 'brand-secondary'];
export const slotSpecials = (slot: string) => (slot === 'accent' ? ACCENT_SPECIALS : ['auto']);

export function setSetting(stored: StoredSettings, group: string, key: string, value: unknown): StoredSettings {
  return { ...stored, [group]: { ...(stored[group] ?? {}), [key]: value } };
}

export function resetGroup(stored: StoredSettings, group: string): StoredSettings {
  const { [group]: _removed, ...rest } = stored;
  return rest;
}

export function setSchemes(stored: StoredSettings, schemes: ThemeScheme[]): StoredSettings {
  return { ...stored, colors: { schemes } };
}

/** Lowest free scheme id, or null at COLOR_SCHEMES_MAX. */
export function nextSchemeId(schemes: { id: string }[]): string | null {
  if (schemes.length >= COLOR_SCHEMES_MAX) return null;
  for (let i = 1; i <= COLOR_SCHEMES_MAX; i += 1) if (!schemes.some((s) => s.id === `scheme-${i}`)) return `scheme-${i}`;
  return null;
}

export function newScheme(id: string, from?: ThemeScheme): ThemeScheme {
  const base: ThemeScheme = from ?? {
    id,
    name: '',
    background: 'auto',
    foreground: 'auto',
    accent: 'brand',
    accentForeground: 'auto',
    secondaryButtonLabel: 'auto',
    border: 'auto',
    muted: 'auto',
    shadow: 'auto',
  };
  const name = from ? `${from.name} copy`.slice(0, 30) : `Scheme ${id.slice('scheme-'.length)}`;
  return { ...base, id, name };
}

/** Effective schemes: the stored list, else the preset's. */
export function schemesOf(stored: StoredSettings, preset: ThemeSettings | undefined): ThemeScheme[] {
  return (stored.colors?.schemes ?? preset?.colors?.schemes ?? []) as ThemeScheme[];
}
