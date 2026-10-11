'use client';

// Shared pieces of the admin event and venue pages: tier colors, the status
// pill, the ticket-stub perforation, the capacity meter, and the venue
// editor's jump links and save card. (The old event editor's summary stub went
// with the editor in spec 050-P.)

import React from 'react';

/** Tier colors, shared with the tier list so a meter segment and its row match. */
const TIER_ACCENTS = [
  { bar: 'bg-accent-500', soft: 'bg-accent-500/40', dot: 'bg-accent-500' },
  { bar: 'bg-sky-500', soft: 'bg-sky-500/40', dot: 'bg-sky-500' },
  { bar: 'bg-emerald-500', soft: 'bg-emerald-500/40', dot: 'bg-emerald-500' },
  { bar: 'bg-amber-500', soft: 'bg-amber-500/40', dot: 'bg-amber-500' },
  { bar: 'bg-rose-500', soft: 'bg-rose-500/40', dot: 'bg-rose-500' },
  { bar: 'bg-teal-500', soft: 'bg-teal-500/40', dot: 'bg-teal-500' },
] as const;

export function tierAccent(index: number) {
  return TIER_ACCENTS[index % TIER_ACCENTS.length];
}

const STATUS_PILL: Record<string, string> = {
  DRAFT: 'bg-white/90 text-gray-800 ring-gray-900/10 dark:bg-slate-900/80 dark:text-slate-200 dark:ring-white/10',
  PUBLISHED: 'bg-emerald-50/95 text-emerald-800 ring-emerald-600/20 dark:bg-emerald-950/80 dark:text-emerald-300 dark:ring-emerald-400/20',
  CANCELLED: 'bg-red-50/95 text-red-800 ring-red-600/20 dark:bg-red-950/80 dark:text-red-300 dark:ring-red-400/20',
};

const STATUS_DOT: Record<string, string> = {
  DRAFT: 'bg-gray-400 dark:bg-slate-500',
  PUBLISHED: 'bg-emerald-500',
  CANCELLED: 'bg-red-500',
};

export function EventStatusPill({ status, className = '' }: { status: string; className?: string }) {
  const label = status.charAt(0) + status.slice(1).toLowerCase();
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${STATUS_PILL[status] ?? STATUS_PILL.DRAFT} ${className}`}
    >
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status] ?? STATUS_DOT.DRAFT}`} />
      {label}
    </span>
  );
}

export interface SummaryTier {
  key: string;
  name: string;
  quantityTotal: number;
  quantitySold: number;
}

const n = (value: number) => value.toLocaleString('en-US');

/**
 * Scroll only the nearest scrolling ancestor (the admin shell's <main>): a plain
 * anchor or scrollIntoView would also scroll the overflow-hidden app frame and
 * push the sidebar off screen. Focus follows for keyboard users.
 */
export function jumpTo(id: string) {
  const target = document.getElementById(id);
  if (!target) return;
  let scroller = target.parentElement;
  while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (scroller) {
    const top = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 24;
    scroller.scrollTo({ top, behavior: reduce ? 'auto' : 'smooth' });
  }
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
}

/**
 * Save state and actions, pinned to the bottom of the viewport while the aside
 * is taller than the screen and resting under the last card once it is not,
 * so it never hides a field for good. Hidden below `xl` (the page's bottom bar
 * takes over there).
 */
export function EventSaveCard({ dirty, children }: { dirty: boolean; children: React.ReactNode }) {
  return (
    <div className="hidden xl:sticky xl:bottom-6 xl:z-10 xl:mt-auto xl:block">
      <div
        className={`rounded-xl border bg-white/95 p-4 shadow-lg backdrop-blur transition-colors motion-reduce:transition-none dark:bg-slate-800/95 sm:p-5 ${
          dirty
            ? 'border-amber-300 shadow-amber-500/10 dark:border-amber-500/40'
            : 'border-gray-200 shadow-gray-900/5 dark:border-slate-700/80 dark:shadow-black/20'
        }`}
      >
        <SaveState dirty={dirty} />
        <div className="mt-3">{children}</div>
      </div>
    </div>
  );
}

/** Dashed tear line with half-circle notches punched out of both edges. */
export function Perforation() {
  const notch =
    'absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border border-gray-200 bg-gray-50 dark:border-slate-700/80 dark:bg-slate-900';
  return (
    <div aria-hidden className="relative h-4">
      <span className={`${notch} -left-2`} />
      <span className="absolute inset-x-4 top-1/2 border-t-2 border-dashed border-gray-200 dark:border-slate-700" />
      <span className={`${notch} -right-2`} />
    </div>
  );
}

function SaveState({ dirty }: { dirty: boolean }) {
  return (
    <p role="status" className="flex items-center gap-2 text-xs font-medium">
      <span className="relative flex h-2 w-2" aria-hidden>
        {dirty && (
          <span className="absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-60 motion-safe:animate-ping" />
        )}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${dirty ? 'bg-amber-500' : 'bg-gray-300 dark:bg-slate-600'}`} />
      </span>
      <span className={dirty ? 'text-amber-700 dark:text-amber-300' : 'text-gray-500 dark:text-slate-400'}>
        {dirty ? 'Unsaved changes' : 'No unsaved changes'}
      </span>
    </p>
  );
}

/**
 * One bar for the whole event: each tier's allocation as a segment (sold part
 * solid, the rest tinted), then any capacity no tier holds yet, hatched.
 */
export function CapacityMeter({ capacity: rawCapacity, tiers }: { capacity: number | null; tiers: SummaryTier[] }) {
  // Null = a wizard draft without a capacity yet (spec 050): no ceiling to draw against.
  const unset = rawCapacity === null;
  const capacity = rawCapacity ?? 0;
  const allocated = tiers.reduce((sum, t) => sum + t.quantityTotal, 0);
  const sold = tiers.reduce((sum, t) => sum + t.quantitySold, 0);
  const scale = Math.max(capacity, allocated, 1);
  const over = capacity > 0 && allocated > capacity;
  const unallocated = Math.max(capacity - allocated, 0);

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-500 dark:text-slate-400">Capacity</p>
        <p className="text-xs tabular-nums text-gray-600 dark:text-slate-300">
          {unset ? (
            'Capacity not set'
          ) : (
            <>
              <span className="font-semibold text-gray-900 dark:text-white">{n(allocated)}</span>
              {' / '}
              {capacity > 0 ? n(capacity) : '—'} in tiers
            </>
          )}
        </p>
      </div>

      <div
        role="img"
        aria-label={
          unset
            ? `Capacity not set, ${n(allocated)} in tiers, ${n(sold)} sold`
            : `${n(allocated)} of ${n(capacity)} capacity assigned to tiers, ${n(sold)} sold${over ? '. Tiers exceed capacity' : ''}`
        }
        className={`mt-2 flex h-2.5 w-full gap-px overflow-hidden rounded-full bg-gray-100 dark:bg-slate-900 ${over ? 'ring-2 ring-red-500/70 ring-offset-1 ring-offset-white dark:ring-offset-slate-800' : ''}`}
      >
        {tiers.map((tier, i) =>
          tier.quantityTotal > 0 ? (
            <span
              key={tier.key}
              className={`relative h-full transition-[width] duration-300 motion-reduce:transition-none ${tierAccent(i).soft}`}
              style={{ width: `${(tier.quantityTotal / scale) * 100}%` }}
            >
              <span
                className={`absolute inset-y-0 left-0 ${tierAccent(i).bar}`}
                style={{ width: `${Math.min(tier.quantitySold / tier.quantityTotal, 1) * 100}%` }}
              />
            </span>
          ) : null
        )}
        {unallocated > 0 && (
          <span
            className="h-full [background-image:repeating-linear-gradient(135deg,rgb(148_163_184/0.35)_0_2px,transparent_2px_5px)]"
            style={{ width: `${(unallocated / scale) * 100}%` }}
          />
        )}
      </div>

      <p className="mt-1.5 text-xs tabular-nums text-gray-500 dark:text-slate-400">
        {n(sold)} sold
        {over ? (
          <span className="font-medium text-red-600 dark:text-red-400"> · {n(allocated - capacity)} over capacity</span>
        ) : unallocated > 0 && tiers.length > 0 ? (
          <> · {n(unallocated)} unassigned</>
        ) : null}
      </p>

      {tiers.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {tiers.map((tier, i) => (
            <li key={tier.key} className="flex items-center gap-2 text-xs">
              <span aria-hidden className={`h-2 w-2 shrink-0 rounded-sm ${tierAccent(i).dot}`} />
              <span className="min-w-0 flex-1 truncate text-gray-700 dark:text-slate-300">{tier.name || 'Untitled tier'}</span>
              <span className="shrink-0 tabular-nums text-gray-500 dark:text-slate-400">
                {n(tier.quantitySold)}
                <span className="text-gray-400 dark:text-slate-500"> / {tier.quantityTotal ? n(tier.quantityTotal) : '—'}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
