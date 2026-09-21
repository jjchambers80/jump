import { describe, test, expect } from 'vitest';
import {
  naturalSort,
  generateAutoNumberLabels,
  computeRowLayout,
} from '../../src/components/maps/boothLabels';

describe('naturalSort', () => {
  test('sorts by numeric part', () => {
    const labels = ['A10', 'A2', 'A1', 'A20'];
    const sorted = [...labels].sort(naturalSort);
    expect(sorted).toEqual(['A1', 'A2', 'A10', 'A20']);
  });

  test('sorts by letter prefix', () => {
    const labels = ['B1', 'A1', 'C1'];
    const sorted = [...labels].sort(naturalSort);
    expect(sorted).toEqual(['A1', 'B1', 'C1']);
  });

  test('mixed formats', () => {
    const labels = ['AA10', 'A2', 'B1', 'AA2'];
    const sorted = [...labels].sort(naturalSort);
    expect(sorted).toEqual(['A2', 'AA2', 'AA10', 'B1']);
  });
});

describe('generateAutoNumberLabels', () => {
  test('fills left-to-right, top-to-bottom (row direction)', () => {
    const labels = generateAutoNumberLabels(6, 3, 2, {
      prefix: 'B',
      start: 1,
      direction: 'row',
      snake: false,
    });
    expect(labels).toEqual(['B1', 'B2', 'B3', 'B4', 'B5', 'B6']);
  });

  test('fills top-to-bottom, left-to-right (column direction)', () => {
    const labels = generateAutoNumberLabels(6, 3, 2, {
      prefix: 'A',
      start: 1,
      direction: 'column',
      snake: false,
    });
    expect(labels).toEqual(['A1', 'A4', 'A2', 'A5', 'A3', 'A6']);
  });

  test('snake pattern alternates direction (row)', () => {
    const labels = generateAutoNumberLabels(6, 3, 2, {
      prefix: 'B',
      start: 1,
      direction: 'row',
      snake: true,
    });
    // row 0: B1 B2 B3; row 1 (snake): B6 B5 B4
    expect(labels).toEqual(['B1', 'B2', 'B3', 'B6', 'B5', 'B4']);
  });

  test('snake pattern alternates direction (column)', () => {
    const labels = generateAutoNumberLabels(6, 3, 2, {
      prefix: 'A',
      start: 1,
      direction: 'column',
      snake: true,
    });
    // col 0 normal top-to-bottom -> A1, A4
    // col 1 snake bottom-to-top -> A5, A2
    // col 2 normal top-to-bottom -> A3, A6
    expect(labels).toEqual(['A1', 'A4', 'A5', 'A2', 'A3', 'A6']);
  });
});

describe('computeRowLayout', () => {
  test('places booths horizontally', () => {
    const result = computeRowLayout(0, 0, 3, 10, 10, 2, 'row', 'B', 1);
    expect(result.booths).toHaveLength(3);
    expect(result.booths[0]).toEqual({ x: 0, y: 0, label: 'B1' });
    expect(result.booths[1]).toEqual({ x: 12, y: 0, label: 'B2' });
    expect(result.booths[2]).toEqual({ x: 24, y: 0, label: 'B3' });
  });

  test('places booths vertically', () => {
    const result = computeRowLayout(0, 0, 3, 10, 10, 3, 'column', 'C', 1);
    expect(result.booths).toHaveLength(3);
    expect(result.booths[0]).toEqual({ x: 0, y: 0, label: 'C1' });
    expect(result.booths[1]).toEqual({ x: 0, y: 13, label: 'C2' });
    expect(result.booths[2]).toEqual({ x: 0, y: 26, label: 'C3' });
  });

  test('handles non-uniform booth sizes', () => {
    const result = computeRowLayout(5, 10, 4, 8, 6, 1, 'row', 'Z', 10);
    expect(result.booths[0]).toEqual({ x: 5, y: 10, label: 'Z10' });
    expect(result.booths[1]).toEqual({ x: 14, y: 10, label: 'Z11' });
    expect(result.booths[3]).toEqual({ x: 32, y: 10, label: 'Z13' });
  });
});