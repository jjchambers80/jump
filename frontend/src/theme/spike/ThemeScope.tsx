// Spike 038-0 (§9a.6): server theming. Emits the brand + theme-setting CSS
// variables on a wrapper div and, when the org forces a mode, a blocking
// inline script that sets `dark` on <html> before first paint.
// `staticMode` (thumbnails) writes the class into the markup and runs no script.

import type { CSSProperties, ReactNode } from 'react';
import { brandCssVars } from '@/lib/color';
import { isThemeMode, type ThemeMode } from '@/lib/theme';
import ThemeModeSync from './ThemeModeSync';

export interface SpikeThemeSettings {
  pageWidth: number;
  radius: number;
  buttonRadius: number;
  sectionGap: number;
  headingFont: string;
}

export const DEFAULT_SETTINGS: SpikeThemeSettings = {
  pageWidth: 1200,
  radius: 16,
  buttonRadius: 9999,
  sectionGap: 0,
  headingFont: 'inherit',
};

export function settingsCssVars(settings: SpikeThemeSettings): Record<string, string> {
  return {
    '--theme-page-width': `${settings.pageWidth}px`,
    '--theme-radius': `${settings.radius}px`,
    '--theme-button-radius': `${settings.buttonRadius}px`,
    '--theme-section-gap': `${settings.sectionGap}px`,
    '--theme-heading-font': settings.headingFont,
  };
}

// Runs before the body is parsed (same idea as next-themes' script). The
// source is built only from the ThemeMode enum, never from tenant input.
function modeScript(mode: ThemeMode) {
  const body =
    mode === 'SYSTEM'
      ? "var d=window.matchMedia('(prefers-color-scheme: dark)').matches;"
      : `var d=${mode === 'DARK'};`;
  return `(function(){try{${body}var h=document.documentElement;h.dataset.jumpForced=${JSON.stringify(mode.toLowerCase())};var c=h.classList;c.toggle('dark',d);c.toggle('light',!d);document.documentElement.style.colorScheme=d?'dark':'light';}catch(e){}})();`;
}

export default function ThemeScope({
  brandColor,
  themeMode,
  settings,
  staticMode = false,
  children,
}: {
  brandColor: string | null;
  themeMode: ThemeMode | null;
  settings: SpikeThemeSettings;
  /** Thumbnails: no script; the page shell writes the class on <html>. */
  staticMode?: boolean;
  children: ReactNode;
}) {
  const vars = { ...(brandCssVars(brandColor) ?? {}), ...settingsCssVars(settings) };
  const mode = isThemeMode(themeMode) ? themeMode : null;
  return (
    <div className="brand-scope" style={vars as CSSProperties} data-theme-mode={mode ?? undefined}>
      {mode && !staticMode && (
        <>
          <script dangerouslySetInnerHTML={{ __html: modeScript(mode) }} />
          <ThemeModeSync mode={mode} />
        </>
      )}
      {children}
    </div>
  );
}
