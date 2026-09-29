'use client';

// Forces the organization's light/dark mode through ThemeProvider while an org
// page is mounted and releases it on unmount, so the visitor's own choice
// returns elsewhere (gotcha 7: never setTheme).

import { useEffect } from 'react';
import { useThemeMode } from '@/components/ThemeProvider';
import { themeModeToForced, type ThemeMode } from '@/lib/theme';

export default function ThemeModeSync({ mode }: { mode: ThemeMode | null | undefined }) {
  const { setForced } = useThemeMode();
  const forced = themeModeToForced(mode);
  useEffect(() => {
    if (!forced) return;
    setForced(forced);
    return () => setForced(null);
  }, [forced, setForced]);
  return null;
}
