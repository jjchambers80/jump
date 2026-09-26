// What an organizer can add to a floor map, in plain words, with sensible
// default sizes per unit. The palette, drag-and-drop and keyboard "add" all
// read this one list.

import type { MapElement } from '@/services/api';

export type CatalogKind =
  | 'BOOTH'
  | 'TABLE'
  | 'BLOCK'
  | 'stage'
  | 'entrance'
  | 'restroom'
  | 'food'
  | 'info'
  | 'firstAid'
  | 'programming'
  | 'label'
  | 'wall';

export interface CatalogItem {
  kind: CatalogKind;
  name: string;
  hint: string;
  group: 'sell' | 'place' | 'draw';
  /** Default size in feet; meters divide by ~3.3 (rounded, min 1). */
  sizeFt: { w: number; h: number };
}

export const CATALOG: CatalogItem[] = [
  { kind: 'BOOTH', name: 'Booth', hint: 'A space vendors can buy', group: 'sell', sizeFt: { w: 10, h: 10 } },
  { kind: 'TABLE', name: 'Table', hint: 'A table vendors can buy', group: 'sell', sizeFt: { w: 6, h: 3 } },
  { kind: 'BLOCK', name: 'Rows of booths', hint: 'Add many numbered booths at once', group: 'sell', sizeFt: { w: 10, h: 10 } },
  { kind: 'stage', name: 'Stage', hint: 'Main stage or panel area', group: 'place', sizeFt: { w: 20, h: 10 } },
  { kind: 'entrance', name: 'Entrance', hint: 'Doors in or out', group: 'place', sizeFt: { w: 6, h: 4 } },
  { kind: 'restroom', name: 'Restrooms', hint: 'Toilets', group: 'place', sizeFt: { w: 6, h: 6 } },
  { kind: 'food', name: 'Food & drink', hint: 'Concessions or food court', group: 'place', sizeFt: { w: 8, h: 6 } },
  { kind: 'info', name: 'Info desk', hint: 'Help or registration', group: 'place', sizeFt: { w: 6, h: 4 } },
  { kind: 'firstAid', name: 'First aid', hint: 'Medical station', group: 'place', sizeFt: { w: 6, h: 4 } },
  { kind: 'programming', name: 'Activity area', hint: 'Gaming, workshops, play area', group: 'place', sizeFt: { w: 12, h: 8 } },
  { kind: 'label', name: 'Text', hint: 'A name for an area, like “Artist Alley”', group: 'draw', sizeFt: { w: 12, h: 2 } },
  { kind: 'wall', name: 'Wall', hint: 'A straight wall or divider', group: 'draw', sizeFt: { w: 20, h: 1 } },
];

export const CATALOG_BY_KIND: Record<CatalogKind, CatalogItem> = Object.fromEntries(
  CATALOG.map((c) => [c.kind, c])
) as Record<CatalogKind, CatalogItem>;

export const GROUP_TITLES: Record<CatalogItem['group'], string> = {
  sell: 'Spaces to sell',
  place: 'Landmarks',
  draw: 'Text & walls',
};

/** Drag-and-drop payload type for palette → canvas drops. */
export const DRAG_MIME = 'application/x-jump-map-item';

/**
 * The palette item being dragged. `dataTransfer` data is unreadable during
 * dragover, and the canvas needs the kind to draw the drop preview.
 */
export const dragState: { kind: CatalogKind | null } = { kind: null };

export function defaultSize(kind: CatalogKind, unit: string): { w: number; h: number } {
  const ft = CATALOG_BY_KIND[kind].sizeFt;
  if (unit !== 'm') return { ...ft };
  return { w: Math.max(1, Math.round(ft.w / 3.3)), h: Math.max(1, Math.round(ft.h / 3.3)) };
}

export function isBoothKind(kind: CatalogKind): kind is 'BOOTH' | 'TABLE' {
  return kind === 'BOOTH' || kind === 'TABLE';
}

export function isElementKind(kind: CatalogKind): kind is MapElement['kind'] & CatalogKind {
  return !isBoothKind(kind) && kind !== 'BLOCK';
}

/** Name shown for a layout element in the inspector and screen-reader text. */
export function elementName(kind: MapElement['kind']): string {
  return (CATALOG_BY_KIND as Record<string, CatalogItem | undefined>)[kind]?.name ?? 'Item';
}

export function unitLabel(unit: string, long = false): string {
  if (unit === 'm') return long ? 'meters' : 'm';
  return long ? 'feet' : 'ft';
}
