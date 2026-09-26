// Floor map builder placement helpers. Pure functions, no React: the builder
// page and the Vitest suite (tests/unit/mapPlacement.test.ts) share them.
//
// Every coordinate is in floor units (feet or meters), integers only — the
// backend rejects fractional booth positions (MapService.replaceLayout).

import type { MapBooth, MapElement } from '@/services/api';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const MAX_ITEM_SIZE = 50;

/** The on-floor footprint of a booth. Legacy rotation 90 booths render turned about their centre. */
export function boothFootprint(b: Pick<MapBooth, 'x' | 'y' | 'w' | 'h' | 'rotation'>): Box {
  if (b.rotation !== 90) return { x: b.x, y: b.y, w: b.w, h: b.h };
  return { x: b.x + (b.w - b.h) / 2, y: b.y + (b.h - b.w) / 2, w: b.h, h: b.w };
}

/** The clickable footprint of a layout element (walls are lines, labels are text). */
export function elementFootprint(e: MapElement): Box {
  if (e.kind === 'wall') {
    return e.orientation === 'v'
      ? { x: e.x, y: e.y, w: 0, h: Math.max(e.h, 1) }
      : { x: e.x, y: e.y, w: Math.max(e.w, 1), h: 0 };
  }
  return { x: e.x, y: e.y, w: Math.max(e.w, 1), h: Math.max(e.h, 1) };
}

export function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Keep a box on the floor; shrinks it first when it is bigger than the floor. */
export function clampToFloor(box: Box, floorW: number, floorH: number): Box {
  const w = Math.max(1, Math.min(box.w, floorW));
  const h = Math.max(1, Math.min(box.h, floorH));
  return {
    x: Math.round(Math.max(0, Math.min(box.x, floorW - w))),
    y: Math.round(Math.max(0, Math.min(box.y, floorH - h))),
    w,
    h,
  };
}

/**
 * Find the free spot closest to (x, y) for a w×h box, scanning outwards in
 * rings. Falls back to the clamped requested spot when the floor is full, so
 * an add never silently fails.
 */
export function findFreeSpot(
  x: number,
  y: number,
  w: number,
  h: number,
  taken: Box[],
  floorW: number,
  floorH: number
): { x: number; y: number } {
  const start = clampToFloor({ x, y, w, h }, floorW, floorH);
  const fits = (cx: number, cy: number) =>
    cx >= 0 && cy >= 0 && cx + w <= floorW && cy + h <= floorH &&
    !taken.some((t) => overlaps({ x: cx, y: cy, w, h }, t));
  if (fits(start.x, start.y)) return { x: start.x, y: start.y };
  const maxRing = Math.max(floorW, floorH);
  for (let r = 1; r <= maxRing; r++) {
    let best: { x: number; y: number; d: number } | null = null;
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const cx = start.x + dx;
        const cy = start.y + dy;
        if (!fits(cx, cy)) continue;
        const d = dx * dx + dy * dy;
        if (!best || d < best.d) best = { x: cx, y: cy, d };
      }
    }
    if (best) return { x: best.x, y: best.y };
  }
  return { x: start.x, y: start.y };
}

/**
 * Next free label for a prefix: "" → "1", "2"…; "A" → "A1", "A2"… — one past
 * the highest number already used with that prefix, skipping taken labels.
 */
export function nextBoothLabel(existing: string[], prefix = ''): string {
  const taken = new Set(existing);
  const pattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)$`);
  let max = 0;
  for (const label of existing) {
    const m = label.match(pattern);
    if (m) max = Math.max(max, Number(m[1]));
  }
  let n = max + 1;
  while (taken.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

export interface BoothBlockOptions {
  rows: number;
  columns: number;
  boothW: number;
  boothH: number;
  /** Space left between booths in a row. */
  gap: number;
  /** Walkway between rows. */
  aisle: number;
  prefix: string;
  start: number;
}

/** Positions and labels for a rows × columns block of booths, numbered left→right, top→bottom. */
export function boothBlock(originX: number, originY: number, o: BoothBlockOptions) {
  const out: { x: number; y: number; label: string }[] = [];
  let n = o.start;
  for (let r = 0; r < o.rows; r++) {
    for (let c = 0; c < o.columns; c++) {
      out.push({
        x: originX + c * (o.boothW + o.gap),
        y: originY + r * (o.boothH + o.aisle),
        label: `${o.prefix}${n++}`,
      });
    }
  }
  return out;
}

export function boothBlockSize(o: BoothBlockOptions): { w: number; h: number } {
  return {
    w: o.columns * o.boothW + Math.max(0, o.columns - 1) * o.gap,
    h: o.rows * o.boothH + Math.max(0, o.rows - 1) * o.aisle,
  };
}

/** Smallest floor that still holds every booth and element (the floor may not shrink past it). */
export function occupiedExtent(booths: Box[], elements: Box[]): { w: number; h: number } {
  let w = 1;
  let h = 1;
  for (const b of [...booths, ...elements]) {
    w = Math.max(w, Math.ceil(b.x + b.w));
    h = Math.max(h, Math.ceil(b.y + b.h));
  }
  return { w, h };
}

/** Move boxes by (dx, dy) as a group, stopping the whole group at the floor edge. */
export function clampGroupDelta(boxes: Box[], dx: number, dy: number, floorW: number, floorH: number) {
  let minDx = -Infinity;
  let maxDx = Infinity;
  let minDy = -Infinity;
  let maxDy = Infinity;
  for (const b of boxes) {
    minDx = Math.max(minDx, -b.x);
    maxDx = Math.min(maxDx, floorW - (b.x + b.w));
    minDy = Math.max(minDy, -b.y);
    maxDy = Math.min(maxDy, floorH - (b.y + b.h));
  }
  return {
    dx: Math.round(Math.max(minDx, Math.min(dx, maxDx))),
    dy: Math.round(Math.max(minDy, Math.min(dy, maxDy))),
  };
}
