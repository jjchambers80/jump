'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ForcedTheme } from '@/lib/theme';

interface ThemeModeContextValue {
  /** Theme currently forced by an organization page, or null when the visitor's choice applies. */
  forced: ForcedTheme | null;
  setForced: (forced: ForcedTheme | null) => void;
}

const ThemeModeContext = createContext<ThemeModeContextValue>({
  forced: null,
  setForced: () => {},
});

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** Access the org-forced theme state. Used by BrandScope to force and by ThemeToggle to hide. */
export function useThemeMode() {
  return useContext(ThemeModeContext);
}

/**
 * Wraps next-themes. Org-scoped public pages can force light/dark/system via `useThemeMode()`;
 * the forced value is passed as `forcedTheme` so the visitor's stored preference is never
 * overwritten. "system" is resolved here with a live matchMedia listener because next-themes
 * does not re-apply a forced theme when the OS scheme changes.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [forced, setForced] = useState<ForcedTheme | null>(null);
  const [systemTheme, setSystemTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    if (forced !== 'system') return;
    const mql = window.matchMedia(DARK_QUERY);
    const update = () => setSystemTheme(mql.matches ? 'dark' : 'light');
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, [forced]);

  const forcedTheme = forced === 'system' ? systemTheme : forced ?? undefined;
  const value = useMemo(() => ({ forced, setForced }), [forced]);

  return (
    <ThemeModeContext.Provider value={value}>
      <NextThemesProvider attribute="class" defaultTheme="system" enableSystem forcedTheme={forcedTheme}>
        {children}
      </NextThemesProvider>
    </ThemeModeContext.Provider>
  );
}
