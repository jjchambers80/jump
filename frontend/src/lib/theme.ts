/**
 * Organization theme mode: which light/dark mode an organization's public pages use.
 * Mirrors the backend `ThemeMode` Prisma enum.
 */
export type ThemeMode = 'LIGHT' | 'DARK' | 'SYSTEM';

/** Value handed to next-themes as `forcedTheme` (after resolving SYSTEM via matchMedia). */
export type ForcedTheme = 'light' | 'dark' | 'system';

export interface ThemeModeOption {
  value: ThemeMode;
  label: string;
  description: string;
}

/** Ordered list for the admin picker. */
export const THEME_MODES: ThemeModeOption[] = [
  { value: 'LIGHT', label: 'Light', description: 'Always show your public pages in light mode.' },
  { value: 'DARK', label: 'Dark', description: 'Always show your public pages in dark mode.' },
  { value: 'SYSTEM', label: 'System', description: "Follow the visitor's operating system setting (default)." },
];

export const DEFAULT_THEME_MODE: ThemeMode = 'SYSTEM';

export function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === 'string' && THEME_MODES.some((m) => m.value === value);
}

/** Map an org theme mode to the forced value. Unknown/missing means no forcing (visitor's choice). */
export function themeModeToForced(mode: ThemeMode | null | undefined): ForcedTheme | null {
  switch (mode) {
    case 'LIGHT':
      return 'light';
    case 'DARK':
      return 'dark';
    case 'SYSTEM':
      return 'system';
    default:
      return null;
  }
}
