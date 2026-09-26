import { describe, expect, it } from 'vitest';
import {
  boothBlock,
  boothBlockSize,
  boothFootprint,
  clampGroupDelta,
  clampToFloor,
  findFreeSpot,
  nextBoothLabel,
  occupiedExtent,
  overlaps,
} from '@/components/maps/builder/placement';
import { defaultSize } from '@/components/maps/builder/catalog';

describe('nextBoothLabel', () => {
  it('numbers from 1 on an empty map', () => {
    expect(nextBoothLabel([])).toBe('1');
  });
  it('continues after the highest number with the same prefix', () => {
    expect(nextBoothLabel(['A1', 'A2', 'A10', 'B4'], 'A')).toBe('A11');
    expect(nextBoothLabel(['A1', 'B4'], 'B')).toBe('B5');
    expect(nextBoothLabel(['1', '2', 'A9'])).toBe('3');
  });
  it('escapes regex characters in the prefix', () => {
    expect(nextBoothLabel(['A.1', 'AB1'], 'A.')).toBe('A.2');
  });
});

describe('findFreeSpot', () => {
  it('keeps the requested spot when it is free', () => {
    expect(findFreeSpot(5, 5, 10, 10, [], 50, 40)).toEqual({ x: 5, y: 5 });
  });
  it('moves off an occupied spot to the nearest free one', () => {
    const taken = [{ x: 0, y: 0, w: 10, h: 10 }];
    const spot = findFreeSpot(0, 0, 10, 10, taken, 50, 40);
    expect(overlaps({ ...spot, w: 10, h: 10 }, taken[0])).toBe(false);
    expect(spot.x + 10).toBeLessThanOrEqual(50);
    expect(Math.max(spot.x, spot.y)).toBe(10);
  });
  it('clamps a spot outside the floor back onto it', () => {
    expect(findFreeSpot(48, -3, 10, 10, [], 50, 40)).toEqual({ x: 40, y: 0 });
  });
  it('still returns a spot when the floor is full', () => {
    const spot = findFreeSpot(0, 0, 10, 10, [{ x: 0, y: 0, w: 10, h: 10 }], 10, 10);
    expect(spot).toEqual({ x: 0, y: 0 });
  });
});

describe('clampToFloor', () => {
  it('shrinks a box bigger than the floor and keeps it on it', () => {
    expect(clampToFloor({ x: 5, y: 5, w: 80, h: 10 }, 50, 40)).toEqual({ x: 0, y: 5, w: 50, h: 10 });
  });
});

describe('clampGroupDelta', () => {
  it('stops the whole group at the first edge it reaches', () => {
    const boxes = [
      { x: 2, y: 2, w: 4, h: 4 },
      { x: 40, y: 2, w: 8, h: 4 },
    ];
    expect(clampGroupDelta(boxes, 10, -5, 50, 40)).toEqual({ dx: 2, dy: -2 });
  });
});

describe('boothBlock', () => {
  const opts = { rows: 2, columns: 3, boothW: 10, boothH: 10, gap: 0, aisle: 10, prefix: 'A', start: 1 };
  it('numbers left to right, top to bottom, with an aisle between rows', () => {
    const cells = boothBlock(5, 5, opts);
    expect(cells.map((c) => c.label)).toEqual(['A1', 'A2', 'A3', 'A4', 'A5', 'A6']);
    expect(cells[3]).toEqual({ x: 5, y: 25, label: 'A4' });
  });
  it('reports the space the block needs', () => {
    expect(boothBlockSize(opts)).toEqual({ w: 30, h: 30 });
    expect(boothBlockSize({ ...opts, gap: 2 })).toEqual({ w: 34, h: 30 });
  });
});

describe('boothFootprint', () => {
  it('turns a legacy 90° booth about its centre', () => {
    expect(boothFootprint({ x: 5, y: 20, w: 18, h: 8, rotation: 90 })).toEqual({ x: 10, y: 15, w: 8, h: 18 });
  });
});

describe('occupiedExtent', () => {
  it('is the far corner of everything on the floor', () => {
    expect(occupiedExtent([{ x: 30, y: 2, w: 10, h: 10 }], [{ x: 0, y: 25, w: 5, h: 5 }])).toEqual({ w: 40, h: 30 });
  });
});

describe('defaultSize', () => {
  it('uses feet by default and converts for meters', () => {
    expect(defaultSize('BOOTH', 'ft')).toEqual({ w: 10, h: 10 });
    expect(defaultSize('BOOTH', 'm')).toEqual({ w: 3, h: 3 });
  });
});
