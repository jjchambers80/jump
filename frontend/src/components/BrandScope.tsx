'use client';

import { useEffect } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { brandCssVars } from '@/lib/color';
import { themeModeToForced, type ThemeMode } from '@/lib/theme';
import { useThemeMode } from '@/components/ThemeProvider';

interface BrandScopeProps {
  /** Organization brand color (#rrggbb). Null/undefined keeps platform defaults. */
  color: string | null | undefined;
  /** Organization theme mode. LIGHT/DARK/SYSTEM force the page theme; USER/undefined leaves the visitor's choice. */
  themeMode?: ThemeMode | null;
  className?: string;
  children: ReactNode;
}

/**
 * Applies an organization's brand color to everything inside via CSS custom properties.
 * Children use the `brand` Tailwind tokens (bg-brand, hover:bg-brand-hover, text-brand-fg,
 * text-brand-link); with no color the tokens resolve to the platform blue from globals.css.
 *
 * When `themeMode` is LIGHT/DARK/SYSTEM the org theme is forced site-wide while this scope is
 * mounted and released on unmount, so the visitor's own preference returns on other pages.
 */
export default function BrandScope({ color, themeMode, className, children }: BrandScopeProps) {
  const { setForced } = useThemeMode();
  const forced = themeModeToForced(themeMode);

  useEffect(() => {
    if (!forced) return;
    setForced(forced);
    return () => setForced(null);
  }, [forced, setForced]);

  const vars = brandCssVars(color);
  return (
    <div
      className={className ? `brand-scope ${className}` : 'brand-scope'}
      style={vars as CSSProperties | undefined}
      data-brand-color={vars ? vars['--brand'] : undefined}
      data-theme-mode={themeMode ?? undefined}
    >
      {children}
    </div>
  );
}
