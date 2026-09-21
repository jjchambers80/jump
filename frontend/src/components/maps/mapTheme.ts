// Map theme: fixed colour tokens (spec 014 phase 1)
// This is the ONLY file that defines map colours — tier swatches,
// state styles, and marker icons. Never define a map colour elsewhere.

export const SWATCH_COUNT = 6;

/** Tier swatch colours — light and dark variants. */
export const TIER_SWATCHES: { light: string; dark: string }[] = [
  { light: '#4f46e5', dark: '#818cf8' }, // indigo
  { light: '#0891b2', dark: '#22d3ee' }, // cyan
  { light: '#d97706', dark: '#fbbf24' }, // amber
  { light: '#dc2626', dark: '#f87171' }, // red
  { light: '#65a30d', dark: '#a3e635' }, // lime
  { light: '#e11d48', dark: '#fb7185' }, // rose
];

/** Booth state fill colours (light mode). */
export const STATE_FILL_LIGHT: Record<string, string> = {
  AVAILABLE: '#e5e7eb',
  HELD: '#fef3c7',
  SOLD: '#dbeafe',
  RESERVED: '#fef3c7',
  BLOCKED: '#f3f4f6',
  DRAGGING: '#c7d2fe',
  SELECTED: '#c7d2fe',
};

/** Booth state fill colours (dark mode). */
export const STATE_FILL_DARK: Record<string, string> = {
  AVAILABLE: '#374151',
  HELD: '#78350f',
  SOLD: '#1e3a5f',
  RESERVED: '#78350f',
  BLOCKED: '#1f2937',
  DRAGGING: '#312e81',
  SELECTED: '#312e81',
};

/** Booth state stroke colours (light mode). */
export const STATE_STROKE_LIGHT: Record<string, string> = {
  AVAILABLE: '#d1d5db',
  HELD: '#f59e0b',
  SOLD: '#3b82f6',
  RESERVED: '#f59e0b',
  BLOCKED: '#9ca3af',
  DRAGGING: '#6366f1',
  SELECTED: '#6366f1',
};

/** Booth state stroke colours (dark mode). */
export const STATE_STROKE_DARK: Record<string, string> = {
  AVAILABLE: '#4b5563',
  HELD: '#fbbf24',
  SOLD: '#60a5fa',
  RESERVED: '#fbbf24',
  BLOCKED: '#6b7280',
  DRAGGING: '#818cf8',
  SELECTED: '#818cf8',
};

/** Tier swatch for a given swatch index (0-based). Returns CSS `fill` colour. */
export function tierSwatch(index: number, dark: boolean): string {
  const swatch = TIER_SWATCHES[index % SWATCH_COUNT];
  return dark ? swatch.dark : swatch.light;
}

/** State fill for a booth status. */
export function stateFill(status: string, dark: boolean): string {
  return dark ? STATE_FILL_DARK[status] || STATE_FILL_DARK.AVAILABLE : STATE_FILL_LIGHT[status] || STATE_FILL_LIGHT.AVAILABLE;
}

/** State stroke for a booth status. */
export function stateStroke(status: string, dark: boolean): string {
  return dark ? STATE_STROKE_DARK[status] || STATE_STROKE_DARK.AVAILABLE : STATE_STROKE_LIGHT[status] || STATE_STROKE_LIGHT.AVAILABLE;
}

/** Marker icon component names (lucide-react). */
export const MARKER_ICONS: Record<string, string> = {
  stage: 'Mic2',
  entrance: 'DoorOpen',
  restroom: 'Bath',
  food: 'Utensils',
  info: 'Info',
  firstAid: 'Cross',
  programming: 'Gamepad2',
};

/** Human-readable labels for element kinds. */
export const MARKER_LABELS: Record<string, string> = {
  stage: 'Stage',
  entrance: 'Entrance',
  restroom: 'Restroom',
  food: 'Food',
  info: 'Info',
  firstAid: 'First Aid',
  programming: 'Programming',
};

/** Label sizes in px. */
export const LABEL_FONT_SIZES: Record<string, number> = {
  S: 10,
  M: 14,
  L: 18,
};

/** Status label colours for pill badges. */
export const STATUS_BADGE_COLORS: Record<string, string> = {
  DRAFT: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  PUBLISHED: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  AVAILABLE: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  SOLD: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  RESERVED: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  BLOCKED: 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
  HELD: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
};

/** Booth status display labels. */
export const STATUS_LABELS: Record<string, string> = {
  AVAILABLE: 'Available',
  SOLD: 'Sold',
  RESERVED: 'Reserved',
  BLOCKED: 'Blocked',
  HELD: 'Held',
};

// ─── Grid, selection, guides, wall, marker, text ──────────────────────

/** Grid line colour (light). */
export const GRID_LINE_LIGHT = '#e5e7eb';
/** Grid line colour (dark). */
export const GRID_LINE_DARK = '#374151';

/** Selection stroke colour (light). */
export const SELECTION_STROKE_LIGHT = '#6366f1';
/** Selection stroke colour (dark). */
export const SELECTION_STROKE_DARK = '#818cf8';
/** Selection fill (for elements) (light). */
export const SELECTION_FILL_LIGHT = '#c7d2fe';
/** Selection fill (for elements) (dark). */
export const SELECTION_FILL_DARK = '#312e81';

/** Alignment guide colour. */
export const GUIDE_COLOR = '#6366f1';
/** Highlight ring colour when a booth is focused by ?booth= param. */
export const HIGHLIGHT_RING_LIGHT = '#4f46e5';
export const HIGHLIGHT_RING_DARK = '#818cf8';

/** Booth label text fill (light). */
export const BOOTH_LABEL_LIGHT = '#374151';
export const BOOTH_LABEL_DARK = '#f3f4f6';
/** Booth label dim text (dimensions, unused) (light). */
export const BOOTH_DIM_LIGHT = '#6b7280';
export const BOOTH_DIM_DARK = '#9ca3af';
/** Booth vendor name text (light). */
export const BOOTH_VENDOR_LIGHT = '#2563eb';
export const BOOTH_VENDOR_DARK = '#93c5fd';

/** Wall stroke colour (light). */
export const WALL_STROKE_LIGHT = '#6b7280';
/** Wall stroke colour (dark). */
export const WALL_STROKE_DARK = '#d1d5db';

/** Marker fill colour (light). */
export const MARKER_FILL_LIGHT = '#f3f4f6';
/** Marker fill colour (dark). */
export const MARKER_FILL_DARK = '#374151';
/** Marker stroke colour (light). */
export const MARKER_STROKE_LIGHT = '#d1d5db';
/** Marker stroke colour (dark). */
export const MARKER_STROKE_DARK = '#4b5563';
/** Marker icon colour (dark/light). */
export const MARKER_ICON_LIGHT = '#6b7280';
export const MARKER_ICON_DARK = '#9ca3af';
/** Marker caption colour. */
export const MARKER_CAPTION_LIGHT = '#4b5563';
export const MARKER_CAPTION_DARK = '#d1d5db';

/** Label text colour (light). */
export const LABEL_TEXT_LIGHT = '#1f2937';
export const LABEL_TEXT_DARK = '#e5e7eb';

/** Legend tier list background when selected. */
export const LEGEND_SELECTED_BG_LIGHT = 'bg-indigo-50';
export const LEGEND_SELECTED_BG_DARK = 'dark:bg-indigo-900/30';
export const LEGEND_SELECTED_RING = 'ring-1 ring-indigo-500';
export const LEGEND_HOVER_BG_LIGHT = 'hover:bg-gray-50';
export const LEGEND_HOVER_BG_DARK = 'dark:hover:bg-slate-700';

/** Legend state block fill colours. */
export const LEGEND_STATE_LIGHT: Record<string, string> = {
  AVAILABLE: '#e5e7eb',
  SOLD: '#dbeafe',
  RESERVED: '#fef3c7',
  BLOCKED: '#f3f4f6',
};
export const LEGEND_STATE_DARK: Record<string, string> = {
  AVAILABLE: '#374151',
  SOLD: '#1e3a5f',
  RESERVED: '#78350f',
  BLOCKED: '#1f2937',
};
export const LEGEND_STATE_STROKE_LIGHT: Record<string, string> = {
  AVAILABLE: '#d1d5db',
  SOLD: '#3b82f6',
  RESERVED: '#f59e0b',
  BLOCKED: '#9ca3af',
};
export const LEGEND_STATE_STROKE_DARK: Record<string, string> = {
  AVAILABLE: '#4b5563',
  SOLD: '#60a5fa',
  RESERVED: '#fbbf24',
  BLOCKED: '#6b7280',
};