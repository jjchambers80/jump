// Theme setting Background › Retro grid (spec 038 §6.3): a fixed, static
// perspective floor grid along the bottom of the viewport, behind every
// section. Pure CSS in globals.css, no hooks, so the storefront frame and the
// editor canvas both render it. Sections with a transparent color scheme let
// it show through; it stays put on scroll.

import type { ThemeSettings } from './types';

export default function RetroGridBackground({ settings }: { settings: ThemeSettings }) {
  if (settings.background?.style !== 'retro-grid') return null;
  return (
    <div className="retro-grid" aria-hidden="true">
      <div className="retro-grid-floor" />
    </div>
  );
}
