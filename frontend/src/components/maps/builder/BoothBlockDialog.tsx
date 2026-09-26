'use client';

import React, { useMemo, useState } from 'react';
import BuilderDialog, { dialogButton, fieldClass, labelClass } from './BuilderDialog';
import { boothBlock, boothBlockSize, type BoothBlockOptions } from './placement';
import { defaultSize, unitLabel } from './catalog';

interface BoothBlockDialogProps {
  unit: string;
  floorW: number;
  floorH: number;
  existingLabels: string[];
  onClose: () => void;
  onAdd: (opts: BoothBlockOptions) => void;
}

/** "Rows of booths": the fastest way to fill a hall — pick counts and sizes, see it, add it. */
export default function BoothBlockDialog({
  unit,
  floorW,
  floorH,
  existingLabels,
  onClose,
  onAdd,
}: BoothBlockDialogProps) {
  const size = defaultSize('BOOTH', unit);
  const [rows, setRows] = useState(2);
  const [columns, setColumns] = useState(4);
  const [boothW, setBoothW] = useState(size.w);
  const [boothH, setBoothH] = useState(size.h);
  const [gap, setGap] = useState(0);
  const [aisle, setAisle] = useState(unit === 'm' ? 3 : 10);
  const [prefix, setPrefix] = useState(() => suggestPrefix(existingLabels));
  const [start, setStart] = useState(1);

  const opts: BoothBlockOptions = { rows, columns, boothW, boothH, gap, aisle, prefix: prefix.trim(), start };
  const total = rows * columns;
  const extent = boothBlockSize(opts);
  const labels = useMemo(() => boothBlock(0, 0, opts).map((b) => b.label), [rows, columns, prefix, start]); // eslint-disable-line react-hooks/exhaustive-deps
  const clash = labels.find((l) => existingLabels.includes(l));
  const tooWide = extent.w > floorW;
  const tooTall = extent.h > floorH;
  const invalid =
    total < 1 || total > 300 || boothW < 1 || boothH < 1 || boothW > 50 || boothH > 50 || tooWide || tooTall || Boolean(clash);

  const u = unitLabel(unit);
  const num = (setter: (n: number) => void, min: number, max: number) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const n = Math.round(Number(e.target.value));
    setter(Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : min);
  };

  // Preview scaled into a fixed box.
  const pw = 320;
  const ph = 150;
  const k = Math.min(pw / Math.max(extent.w, 1), ph / Math.max(extent.h, 1));
  const cells = boothBlock(0, 0, opts);

  return (
    <BuilderDialog
      titleId="booth-block-title"
      title="Add rows of booths"
      description="Numbered booths laid out in rows, with a walkway between each row."
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className={dialogButton.secondary} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={dialogButton.primary} disabled={invalid} onClick={() => onAdd(opts)}>
            Add {total} booth{total === 1 ? '' : 's'}
          </button>
        </>
      }
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-4">
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-gray-900 dark:text-white">How many</legend>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="bb-rows" className={labelClass}>Rows</label>
                <input id="bb-rows" type="number" inputMode="numeric" min={1} max={30} value={rows} onChange={num(setRows, 1, 30)} className={fieldClass} />
              </div>
              <div>
                <label htmlFor="bb-cols" className={labelClass}>Booths per row</label>
                <input id="bb-cols" type="number" inputMode="numeric" min={1} max={50} value={columns} onChange={num(setColumns, 1, 50)} className={fieldClass} />
              </div>
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-gray-900 dark:text-white">Booth size ({unitLabel(unit, true)})</legend>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="bb-w" className={labelClass}>Width</label>
                <input id="bb-w" type="number" inputMode="numeric" min={1} max={50} value={boothW} onChange={num(setBoothW, 1, 50)} className={fieldClass} />
              </div>
              <div>
                <label htmlFor="bb-h" className={labelClass}>Depth</label>
                <input id="bb-h" type="number" inputMode="numeric" min={1} max={50} value={boothH} onChange={num(setBoothH, 1, 50)} className={fieldClass} />
              </div>
              <div>
                <label htmlFor="bb-gap" className={labelClass}>Space between booths</label>
                <input id="bb-gap" type="number" inputMode="numeric" min={0} max={20} value={gap} onChange={num(setGap, 0, 20)} className={fieldClass} />
              </div>
              <div>
                <label htmlFor="bb-aisle" className={labelClass}>Walkway between rows</label>
                <input id="bb-aisle" type="number" inputMode="numeric" min={0} max={50} value={aisle} onChange={num(setAisle, 0, 50)} className={fieldClass} />
              </div>
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-gray-900 dark:text-white">Numbering</legend>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="bb-prefix" className={labelClass}>Letter in front (optional)</label>
                <input id="bb-prefix" type="text" maxLength={4} value={prefix} onChange={(e) => setPrefix(e.target.value.toUpperCase())} className={fieldClass} placeholder="e.g. A" />
              </div>
              <div>
                <label htmlFor="bb-start" className={labelClass}>Start at</label>
                <input id="bb-start" type="number" inputMode="numeric" min={0} max={9999} value={start} onChange={num(setStart, 0, 9999)} className={fieldClass} />
              </div>
            </div>
          </fieldset>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-gray-900 dark:text-white">Preview</p>
          <div className="flex h-[190px] items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50 p-3 dark:border-slate-700 dark:bg-slate-950/50">
            <svg width={extent.w * k} height={extent.h * k} role="img" aria-label={`Preview: ${rows} rows of ${columns} booths`}>
              {cells.slice(0, 300).map((c) => (
                <g key={c.label}>
                  <rect
                    x={c.x * k + 0.5}
                    y={c.y * k + 0.5}
                    width={Math.max(boothW * k - 1, 1)}
                    height={Math.max(boothH * k - 1, 1)}
                    rx={1.5}
                    className="fill-indigo-100 stroke-indigo-500 dark:fill-indigo-500/20 dark:stroke-indigo-400"
                    strokeWidth={1}
                  />
                  {boothW * k > 18 && boothH * k > 12 && (
                    <text
                      x={c.x * k + (boothW * k) / 2}
                      y={c.y * k + (boothH * k) / 2}
                      textAnchor="middle"
                      dominantBaseline="central"
                      className="fill-indigo-900 dark:fill-indigo-100"
                      fontSize={Math.min(11, (boothW * k) / 3)}
                    >
                      {c.label}
                    </text>
                  )}
                </g>
              ))}
            </svg>
          </div>
          <dl className="mt-3 space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-600 dark:text-slate-400">Booths</dt>
              <dd className="font-medium text-gray-900 dark:text-white">
                {total} ({labels[0]}–{labels[labels.length - 1]})
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-600 dark:text-slate-400">Takes up</dt>
              <dd className={`font-medium ${tooWide || tooTall ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>
                {extent.w} × {extent.h} {u}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-600 dark:text-slate-400">Your floor</dt>
              <dd className="font-medium text-gray-900 dark:text-white">
                {floorW} × {floorH} {u}
              </dd>
            </div>
          </dl>
          <div role="status" aria-live="polite" className="mt-2 text-sm text-red-600 dark:text-red-400">
            {tooWide || tooTall
              ? `That block is bigger than the floor. Use fewer booths, smaller booths, or make the floor bigger in Floor settings.`
              : clash
              ? `Booth ${clash} already exists. Pick another letter or start number.`
              : total > 300
              ? 'Add at most 300 booths at a time.'
              : ''}
          </div>
        </div>
      </div>
    </BuilderDialog>
  );
}

/** First unused capital letter, so a second block does not collide with the first. */
function suggestPrefix(existing: string[]): string {
  if (existing.length === 0) return 'A';
  const used = new Set(existing.map((l) => l.match(/^[A-Z]+/)?.[0]).filter(Boolean));
  for (let i = 0; i < 26; i++) {
    const letter = String.fromCharCode(65 + i);
    if (!used.has(letter)) return letter;
  }
  return '';
}
