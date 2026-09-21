// Layout pure functions for the floor map builder (spec 014 phase 1)
// Grid snap, AABB overlap, duplicate row/column, rotate, nudge.
// All functions are pure — no side effects, no React.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BoothLayout extends Rect {
  label: string;
  rotation: number;
}

/** Snap a coordinate to the nearest grid point. */
export function snapToGrid(value: number, gridSize: number): number {
  return Math.round(value / gridSize) * gridSize;
}

/** Snap to grid with minimum. */
export function snapRect(rect: Rect, gridSize: number): Rect {
  return {
    x: snapToGrid(rect.x, gridSize),
    y: snapToGrid(rect.y, gridSize),
    w: Math.max(1, snapToGrid(rect.w, gridSize)),
    h: Math.max(1, snapToGrid(rect.h, gridSize)),
  };
}

/** AABB overlap check. Rotation 90 swaps w/h for the overlap. */
export function aabbOverlap(a: BoothLayout, b: BoothLayout): boolean {
  const aw = a.rotation === 90 ? a.h : a.w;
  const ah = a.rotation === 90 ? a.w : a.h;
  const bw = b.rotation === 90 ? b.h : b.w;
  const bh = b.rotation === 90 ? b.w : b.h;

  return a.x < b.x + bw && a.x + aw > b.x && a.y < b.y + bh && a.y + ah > b.y;
}

/** Check if booth A overlaps any booth in the list (excluding itself by label). */
export function hasOverlap(booth: BoothLayout, others: BoothLayout[]): boolean {
  return others.some((b) => b.label !== booth.label && aabbOverlap(booth, b));
}

/** Duplicate a row of booths: move each booth in the row down by `offsetY`. */
export function duplicateRow(booths: BoothLayout[], rowY: number, rowH: number): BoothLayout[] {
  const inRow = booths.filter((b) => b.y >= rowY && b.y < rowY + rowH);
  const maxLabelNum = Math.max(
    ...booths
      .map((b) => parseInt(b.label.match(/\d+/)?.[0] || '0', 10))
      .filter((n) => !isNaN(n)),
    0
  );
  return inRow.map((b) => ({
    ...b,
    y: b.y + rowH,
    label: `${b.label.replace(/\d+/g, '')}${maxLabelNum + 1 + inRow.indexOf(b)}`,
  }));
}

/** Duplicate a column of booths. */
export function duplicateColumn(booths: BoothLayout[], colX: number, colW: number): BoothLayout[] {
  const inCol = booths.filter((b) => b.x >= colX && b.x < colX + colW);
  const maxLabelNum = Math.max(
    ...booths
      .map((b) => parseInt(b.label.match(/\d+/)?.[0] || '0', 10))
      .filter((n) => !isNaN(n)),
    0
  );
  return inCol.map((b) => ({
    ...b,
    x: b.x + colW,
    label: `${b.label.replace(/\d+/g, '')}${maxLabelNum + 1 + inCol.indexOf(b)}`,
  }));
}

/** Rotate a booth around its centre (0 or 90 degrees). */
export function rotateRect(rect: Rect, rotation: 0 | 90): Rect {
  if (rotation === 90) {
    return { x: rect.x, y: rect.y, w: rect.h, h: rect.w };
  }
  return { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
}

/** Nudge a rect by dx, dy. */
export function nudgeRect(rect: Rect, dx: number, dy: number): Rect {
  return { x: rect.x + dx, y: rect.y + dy, w: rect.w, h: rect.h };
}

/** Constrain a rect within bounds. */
export function clampRect(rect: Rect, maxW: number, maxH: number): Rect {
  return {
    x: Math.max(0, Math.min(rect.x, maxW - rect.w)),
    y: Math.max(0, Math.min(rect.y, maxH - rect.h)),
    w: Math.min(rect.w, maxW),
    h: Math.min(rect.h, maxH),
  };
}

/** Alignment guide lines for a dragged rect against a set of reference rects. */
export interface GuideLine {
  axis: 'x' | 'y';
  pos: number;
}

export function findAlignmentGuides(
  dragged: Rect,
  references: Rect[],
  threshold: number = 5
): GuideLine[] {
  const guides: GuideLine[] = [];
  const d = {
    left: dragged.x,
    right: dragged.x + dragged.w,
    cx: dragged.x + dragged.w / 2,
    top: dragged.y,
    bottom: dragged.y + dragged.h,
    cy: dragged.y + dragged.h / 2,
  };

  for (const ref of references) {
    const r = {
      left: ref.x,
      right: ref.x + ref.w,
      cx: ref.x + ref.w / 2,
      top: ref.y,
      bottom: ref.y + ref.h,
      cy: ref.y + ref.h / 2,
    };

    // x-axis: match left, right, center
    for (const dk of ['left', 'right', 'cx'] as const) {
      for (const rk of ['left', 'right', 'cx'] as const) {
        const diff = Math.abs(d[dk] - r[rk]);
        if (diff <= threshold && !guides.some((g) => g.axis === 'x' && g.pos === r[rk])) {
          guides.push({ axis: 'x', pos: r[rk] });
        }
      }
    }

    // y-axis: match top, bottom, center
    for (const dk of ['top', 'bottom', 'cy'] as const) {
      for (const rk of ['top', 'bottom', 'cy'] as const) {
        const diff = Math.abs(d[dk] - r[rk]);
        if (diff <= threshold && !guides.some((g) => g.axis === 'y' && g.pos === r[rk])) {
          guides.push({ axis: 'y', pos: r[rk] });
        }
      }
    }
  }

  return guides;
}

/** Clone a booth with a unique label generated from the existing labels. */
export function cloneBooth(booth: BoothLayout, existingLabels: string[]): BoothLayout {
  const base = booth.label.replace(/\d+$/, '');
  const nums = existingLabels
    .map((l) => parseInt(l.match(/\d+/)?.[0] || '0', 10))
    .filter((n) => !isNaN(n));
  const maxNum = nums.length > 0 ? Math.max(...nums) : 0;
  const label = `${base}${maxNum + 1}`;
  return { ...booth, x: booth.x + 20, y: booth.y + 20, label };
}