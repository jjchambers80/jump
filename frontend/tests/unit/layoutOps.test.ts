import { describe, test, expect } from 'vitest';
import {
  snapToGrid,
  snapRect,
  aabbOverlap,
  hasOverlap,
  rotateRect,
  nudgeRect,
  clampRect,
  findAlignmentGuides,
  cloneBooth,
  type BoothLayout,
} from '../../src/components/maps/layoutOps';

describe('snapToGrid', () => {
  test('snaps to nearest grid point', () => {
    expect(snapToGrid(13, 10)).toBe(10);
    expect(snapToGrid(17, 10)).toBe(20);
    expect(snapToGrid(15, 10)).toBe(20);
    expect(snapToGrid(0, 10)).toBe(0);
  });
});

describe('snapRect', () => {
  test('snaps all rect properties to grid', () => {
    const result = snapRect({ x: 12, y: 17, w: 8, h: 23 }, 10);
    expect(result.x).toBe(10);
    expect(result.y).toBe(20);
    expect(result.w).toBe(10);
    expect(result.h).toBe(20);
  });
});

describe('aabbOverlap', () => {
  test('overlapping rects', () => {
    const a: BoothLayout = { label: 'A', x: 0, y: 0, w: 10, h: 10, rotation: 0 };
    const b: BoothLayout = { label: 'B', x: 5, y: 5, w: 10, h: 10, rotation: 0 };
    expect(aabbOverlap(a, b)).toBe(true);
  });

  test('non-overlapping rects', () => {
    const a: BoothLayout = { label: 'A', x: 0, y: 0, w: 10, h: 10, rotation: 0 };
    const b: BoothLayout = { label: 'B', x: 20, y: 20, w: 10, h: 10, rotation: 0 };
    expect(aabbOverlap(a, b)).toBe(false);
  });

  test('rotated overlapping rect (90 deg swaps w/h)', () => {
    const a: BoothLayout = { label: 'A', x: 0, y: 0, w: 10, h: 20, rotation: 90 };
    const b: BoothLayout = { label: 'B', x: 5, y: 5, w: 10, h: 10, rotation: 0 };
    // After rotation: A is 20x10, so it overlaps at (5,5)
    expect(aabbOverlap(a, b)).toBe(true);
  });

  test('touching edges do not overlap', () => {
    const a: BoothLayout = { label: 'A', x: 0, y: 0, w: 10, h: 10, rotation: 0 };
    const b: BoothLayout = { label: 'B', x: 10, y: 0, w: 10, h: 10, rotation: 0 };
    expect(aabbOverlap(a, b)).toBe(false);
  });
});

describe('rotateRect', () => {
  test('rotate 90 swaps w/h', () => {
    const result = rotateRect({ x: 10, y: 20, w: 30, h: 40 }, 90);
    expect(result).toEqual({ x: 10, y: 20, w: 40, h: 30 });
  });

  test('rotate 0 leaves unchanged', () => {
    const result = rotateRect({ x: 10, y: 20, w: 30, h: 40 }, 0);
    expect(result).toEqual({ x: 10, y: 20, w: 30, h: 40 });
  });
});

describe('nudgeRect', () => {
  test('moves by dx, dy', () => {
    expect(nudgeRect({ x: 10, y: 20, w: 30, h: 40 }, 5, -3)).toEqual({ x: 15, y: 17, w: 30, h: 40 });
  });
});

describe('clampRect', () => {
  test('clamps within bounds', () => {
    expect(clampRect({ x: -5, y: -5, w: 10, h: 10 }, 100, 100)).toEqual({ x: 0, y: 0, w: 10, h: 10 });
    expect(clampRect({ x: 95, y: 95, w: 10, h: 10 }, 100, 100)).toEqual({ x: 90, y: 90, w: 10, h: 10 });
  });
});

describe('findAlignmentGuides', () => {
  test('finds left/right/center alignment', () => {
    const dragged = { x: 15, y: 0, w: 10, h: 10 };
    const reference = { x: 10, y: 10, w: 10, h: 10 };
    // dragged.left=15 within 5 of ref.right=20? No. dragged.right=25 within 5 of ref.left=10? No.
    // dragged.centerX=20 within 5 of ref.centerX=15? Yes.
    const guides = findAlignmentGuides(dragged, [reference], 5);
    expect(guides.some((g) => g.axis === 'y' && g.pos === 10)).toBe(true);
  });
});

describe('cloneBooth', () => {
  test('generates next label', () => {
    const booth: BoothLayout = { label: 'A1', x: 0, y: 0, w: 10, h: 10, rotation: 0 };
    const existing = ['A1', 'B2', 'A3'];
    const clone = cloneBooth(booth, existing);
    expect(clone.label).toBe('A4');
    expect(clone.x).toBe(20);
    expect(clone.y).toBe(20);
  });
});