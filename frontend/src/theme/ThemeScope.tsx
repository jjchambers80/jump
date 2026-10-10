// Theming wrapper shared by server-rendered themed pages and BrandScope
// (spec 038, contracts C8). No hooks, so Server and Client Components can
// both render it. It sets the brand + theme CSS variables on a wrapper div
// and, on server-rendered pages, emits a blocking script that puts the org's
// forced mode on <html> before first paint.

import type { CSSProperties, ReactNode } from 'react';
import { brandCssVars } from '@/lib/color';
import { isThemeMode, type ThemeMode } from '@/lib/theme';
import ThemeModeSync from './ThemeModeSync';

// Built only from the ThemeMode enum, never from tenant input.
function modeScript(mode: ThemeMode) {
  const dark =
    mode === 'SYSTEM' ? "window.matchMedia('(prefers-color-scheme: dark)').matches" : String(mode === 'DARK');
  const forced = JSON.stringify(mode.toLowerCase());
  return `(function(){try{var d=${dark};var h=document.documentElement;h.dataset.jumpForced=${forced};h.classList.toggle('dark',d);h.classList.toggle('light',!d);h.style.colorScheme=d?'dark':'light';}catch(e){}})();`;
}

/** `--brand-secondary`, `-hover`, `-fg`, `-link-light`, `-link-dark` (spec 049). */
export function secondaryCssVars(secondary: string | null | undefined, brand: string | null | undefined) {
  const vars = brandCssVars(secondary) ?? brandCssVars(brand);
  return vars && Object.fromEntries(Object.entries(vars).map(([k, v]) => [k.replace('--brand', '--brand-secondary'), v]));
}

export interface ThemeScopeProps {
  brandColor: string | null | undefined;
  /** Spec 049: org secondary color for `brand-secondary` scheme accents; unset follows `brandColor`. */
  brandSecondaryColor?: string | null;
  themeMode: ThemeMode | null | undefined;
  /** Extra CSS variables (theme settings, spec 038 §6.3). */
  vars?: Record<string, string>;
  /** Extra CSS (color scheme classes), built from validated values only. */
  css?: string | null;
  /** Emit the blocking mode script. Only server-rendered pages know the mode at first paint. */
  script?: boolean;
  /** Thumbnails: no script and no client sync; the caller writes the mode class. */
  staticMode?: boolean;
  className?: string;
  /** Theme font classes (theme/fonts.ts). Set: the theme typography rules in globals.css apply. */
  fontClassName?: string;
  children: ReactNode;
}

export default function ThemeScope({
  brandColor,
  brandSecondaryColor,
  themeMode,
  vars,
  css,
  script = true,
  staticMode = false,
  className,
  fontClassName,
  children,
}: ThemeScopeProps) {
  const mode = isThemeMode(themeMode) ? themeMode : null;
  const brand = brandCssVars(brandColor);
  const secondary = secondaryCssVars(brandSecondaryColor, brandColor);
  const style = brand || secondary || vars ? ({ ...(brand ?? {}), ...(secondary ?? {}), ...(vars ?? {}) } as CSSProperties) : undefined;
  return (
    <div
      className={['brand-scope', className, fontClassName].filter(Boolean).join(' ')}
      style={style}
      data-theme-type={fontClassName !== undefined ? '' : undefined}
      data-brand-color={brand ? brand['--brand'] : undefined}
      data-theme-mode={mode ?? undefined}
    >
      {mode && script && !staticMode && <script dangerouslySetInnerHTML={{ __html: modeScript(mode) }} />}
      {css && <style dangerouslySetInnerHTML={{ __html: css }} />}
      {mode && !staticMode && <ThemeModeSync mode={mode} />}
      {children}
    </div>
  );
}
