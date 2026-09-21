// Maps configuration (spec 014 phase 1)
// Validation constants, limits, and element types for floor-map definitions
// and the live FloorMap / Booth models.

/** Max booths on a live FloorMap. */
export const MAX_BOOTHS = 1000;

/** Max non-booth elements in a live FloorMap layout. */
export const MAX_ELEMENTS = 500;

/** Max map bounds in grid units. */
export const MAX_MAP_WIDTH = 200;
export const MAX_MAP_HEIGHT = 200;

/** Min / max booth dimensions in grid units. */
export const MIN_BOOTH_SIZE = 1;
export const MAX_BOOTH_SIZE = 50;

/** Booth kinds §3.3 palette. */
export const BOOTH_KINDS = new Set(['BOOTH', 'TABLE']);

/** Allowed rotation values. */
export const ROTATIONS = new Set([0, 90]);

/** Non-booth element kinds §3.3. */
export const ELEMENT_KINDS = new Set([
  'wall', 'aisle', 'stage', 'entrance', 'restroom',
  'food', 'info', 'firstAid', 'programming', 'label',
]);

/** Label text sizes. */
export const LABEL_SIZES = new Set(['S', 'M', 'L']);

/** Map grid units. */
export const UNITS = new Set(['ft', 'm']);

/** Max label text length. */
export const LABEL_MAX = 12;

/** Max caption length. */
export const CAPTION_MAX = 40;

/** Number of fixed tier swatches. */
export const SWATCH_COUNT = 6;

/** Default empty layout. */
export const EMPTY_LAYOUT = { version: 1, elements: [] };

/** Booth hold duration (15 min, used in phase 2). */
export const BOOTH_HOLD_MS = 15 * 60 * 1000;

/** Minimum map name length. */
export const MIN_MAP_NAME_LENGTH = 1;

/** Maximum map name length. */
export const MAX_MAP_NAME_LENGTH = 200;

/** Default grid size (px per grid unit). */
export const DEFAULT_GRID_SIZE = 10;

/** Default underlay opacity. */
export const DEFAULT_UNDERLAY_OPACITY = 40;