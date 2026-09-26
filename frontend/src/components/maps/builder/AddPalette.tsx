'use client';

import React from 'react';
import {
  Square,
  RectangleHorizontal,
  LayoutGrid,
  MicVocal,
  DoorOpen,
  Bath,
  Utensils,
  Info,
  Cross,
  Gamepad2,
  Type,
  Minus,
  type LucideIcon,
} from 'lucide-react';
import { CATALOG, DRAG_MIME, GROUP_TITLES, dragState, type CatalogItem, type CatalogKind } from './catalog';

const ICONS: Record<CatalogKind, LucideIcon> = {
  BOOTH: Square,
  TABLE: RectangleHorizontal,
  BLOCK: LayoutGrid,
  stage: MicVocal,
  entrance: DoorOpen,
  restroom: Bath,
  food: Utensils,
  info: Info,
  firstAid: Cross,
  programming: Gamepad2,
  label: Type,
  wall: Minus,
};

interface AddPaletteProps {
  onAdd: (kind: CatalogKind) => void;
  disabled?: boolean;
}

/**
 * "Add to map": every tile works two ways — click (or Enter) drops the item in
 * the middle of what you are looking at, drag drops it exactly where you let go.
 */
export default function AddPalette({ onAdd, disabled }: AddPaletteProps) {
  const groups = (['sell', 'place', 'draw'] as const).map((g) => ({
    id: g,
    title: GROUP_TITLES[g],
    items: CATALOG.filter((c) => c.group === g),
  }));

  return (
    <nav
      aria-label="Add to map"
      className="flex w-full flex-col gap-5 overflow-y-auto p-3 lg:w-60"
    >
      <div>
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Add to map</h2>
        <p className="mt-0.5 text-xs leading-relaxed text-gray-500 dark:text-slate-400">
          Click to add, or drag onto the floor.
        </p>
      </div>
      {groups.map((g) => (
        <section key={g.id} aria-labelledby={`palette-${g.id}`}>
          <h3
            id={`palette-${g.id}`}
            className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400"
          >
            {g.title}
          </h3>
          <ul className={g.id === 'sell' ? 'space-y-1.5' : 'grid grid-cols-2 gap-1.5'} role="list">
            {g.items.map((item) => (
              <li key={item.kind}>
                <PaletteTile item={item} wide={g.id === 'sell'} onAdd={onAdd} disabled={disabled} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </nav>
  );
}

function PaletteTile({
  item,
  wide,
  onAdd,
  disabled,
}: {
  item: CatalogItem;
  wide: boolean;
  onAdd: (kind: CatalogKind) => void;
  disabled?: boolean;
}) {
  const Icon = ICONS[item.kind];
  const sellable = item.group === 'sell';
  return (
    <button
      type="button"
      draggable={!disabled}
      disabled={disabled}
      onClick={() => onAdd(item.kind)}
      onDragStart={(e) => {
        dragState.kind = item.kind;
        e.dataTransfer.setData(DRAG_MIME, item.kind);
        e.dataTransfer.setData('text/plain', item.name);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onDragEnd={() => {
        dragState.kind = null;
      }}
      aria-label={`Add ${item.name.toLowerCase()}`}
      aria-describedby={`palette-hint-${item.kind}`}
      data-testid={`palette-${item.kind}`}
      className={`group flex w-full cursor-grab items-center gap-2.5 rounded-lg border text-left transition-colors active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-900 motion-safe:transition-transform motion-safe:active:scale-[0.98] ${
        wide ? 'px-3 py-2.5' : 'flex-col justify-center gap-1 px-2 py-2.5 text-center'
      } ${
        sellable
          ? 'border-indigo-200 bg-indigo-50/60 hover:border-indigo-400 hover:bg-indigo-50 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:hover:border-indigo-400/60 dark:hover:bg-indigo-500/20'
          : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-slate-500 dark:hover:bg-slate-700/60'
      }`}
    >
      <span
        className={`flex shrink-0 items-center justify-center rounded-md ${
          wide ? 'h-9 w-9' : 'h-7 w-7'
        } ${
          sellable
            ? 'bg-indigo-600 text-white dark:bg-indigo-500'
            : 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-300'
        }`}
        aria-hidden="true"
      >
        <Icon className={wide ? 'h-[18px] w-[18px]' : 'h-4 w-4'} strokeWidth={2} />
      </span>
      <span className="min-w-0">
        <span className={`block font-medium text-gray-900 dark:text-white ${wide ? 'text-sm' : 'text-xs'}`}>
          {item.name}
        </span>
        <span
          id={`palette-hint-${item.kind}`}
          className={wide ? 'block text-xs text-gray-500 dark:text-slate-400' : 'sr-only'}
        >
          {item.hint}
        </span>
      </span>
    </button>
  );
}
