// Booth label utilities (spec 014 phase 1)
// Natural sort, auto-number generator, row-tool geometry.

/** Natural sort comparison for booth labels (e.g. A2 < A10, B1 > A12). */
export function naturalSort(a: string, b: string): number {
  const split = (s: string): (string | number)[] =>
    s.match(/(\d+)|(\D+)/g)?.map((part) => (isNaN(Number(part)) ? part : Number(part))) || [];

  const aParts = split(a);
  const bParts = split(b);
  const len = Math.min(aParts.length, bParts.length);

  for (let i = 0; i < len; i++) {
    const pa = aParts[i];
    const pb = bParts[i];
    if (typeof pa === 'number' && typeof pb === 'number') {
      if (pa !== pb) return pa - pb;
    } else {
      const cmp = String(pa).localeCompare(String(pb));
      if (cmp !== 0) return cmp;
    }
  }
  return aParts.length - bParts.length;
}

export interface AutoNumberOptions {
  prefix: string;
  start: number;
  /** Fill direction: 'row' means left-to-right, then next row; 'column' means top-to-bottom, then next column. */
  direction: 'row' | 'column';
  /** Snake pattern: alternate direction on each row/column pass. */
  snake: boolean;
}

/**
 * Generate auto-number labels for N booths in a rectangular area.
 * Returns an array of labels in fill order.
 */
export function generateAutoNumberLabels(
  count: number,
  cols: number,
  rows: number,
  opts: AutoNumberOptions
): string[] {
  const labels: string[] = [];

  if (opts.direction === 'row') {
    for (let r = 0; r < rows; r++) {
      const reversedRow = opts.snake && r % 2 === 1;
      for (let c = 0; c < cols; c++) {
        const col = reversedRow ? cols - 1 - c : c;
        const idx = r * cols + col;
        if (idx < count) {
          labels.push(`${opts.prefix}${opts.start + idx}`);
        }
      }
    }
  } else {
    // column direction
    for (let c = 0; c < cols; c++) {
      const reversedCol = opts.snake && c % 2 === 1;
      for (let r = 0; r < rows; r++) {
        const row = reversedCol ? rows - 1 - r : r;
        const idx = row * cols + c;
        if (idx < count) {
          labels.push(`${opts.prefix}${opts.start + idx}`);
        }
      }
    }
  }

  return labels;
}

/** Generate a default label from coordinates (e.g. row letter + column number). */
export function defaultBoothLabel(x: number, y: number): string {
  const colLetter = String.fromCharCode(65 + (x % 26));
  return `${colLetter}${y + 1}`;
}

/**
 * Compute row/column layout for the row tool.
 * Places N booths of size boothW x boothH with a gap between them, either
 * horizontally (row) or vertically (column).
 */
export interface RowLayoutResult {
  booths: { x: number; y: number; label: string }[];
}

export function computeRowLayout(
  startX: number,
  startY: number,
  count: number,
  boothW: number,
  boothH: number,
  gap: number,
  direction: 'row' | 'column',
  prefix: string,
  startNum: number
): RowLayoutResult {
  const booths: { x: number; y: number; label: string }[] = [];

  for (let i = 0; i < count; i++) {
    const x = direction === 'row' ? startX + i * (boothW + gap) : startX;
    const y = direction === 'column' ? startY + i * (boothH + gap) : startY;
    booths.push({ x, y, label: `${prefix}${startNum + i}` });
  }

  return { booths };
}