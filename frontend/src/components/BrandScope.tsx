'use client';

import type { ReactNode } from 'react';
import ThemeScope from '@/theme/ThemeScope';
import type { ThemeMode } from '@/lib/theme';

interface BrandScopeProps {
  /** Organization brand color (#rrggbb). Null/undefined keeps platform defaults. */
  color: string | null | undefined;
  /** Organization theme mode. LIGHT/DARK/SYSTEM force the page theme; undefined leaves the visitor's choice. */
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
 *
 * Client-rendered pages (checkout, apply, account) learn the mode only after their fetch, so
 * they get no blocking script: ThemeScope without it, plus ThemeModeSync (spec 038 §9a.6).
 */
export default function BrandScope({ color, themeMode, className, children }: BrandScopeProps) {
  return (
    <ThemeScope brandColor={color} themeMode={themeMode} script={false} className={className}>
      {children}
    </ThemeScope>
  );
}
