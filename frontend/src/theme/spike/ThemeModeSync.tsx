'use client';

// Spike 038-0: tells ThemeProvider (next-themes) about the org-forced mode
// after hydration so it agrees with the blocking script; released on unmount.

import { useEffect } from 'react';
import { useThemeMode } from '@/components/ThemeProvider';
import { themeModeToForced, type ThemeMode } from '@/lib/theme';

export default function ThemeModeSync({ mode }: { mode: ThemeMode }) {
  const { setForced } = useThemeMode();
  const forced = themeModeToForced(mode);
  useEffect(() => {
    if (!forced) return;
    setForced(forced);
    return () => setForced(null);
  }, [forced, setForced]);
  return null;
}
