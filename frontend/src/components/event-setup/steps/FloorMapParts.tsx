// Presentation for the Floor map step (spec 050-M): the existing map's summary
// and the two ways to create one. State lives in FloorMapStep.

import type { Ref } from 'react';
import Link from 'next/link';
import { LayoutTemplate, Map as MapIcon, Plus } from 'lucide-react';
import type { AdminMapDetail, FloorPlanSummary } from '@/services/api';
import { primaryButton, secondaryButton } from '../ui';

const card = 'rounded-lg border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800 sm:p-6';
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
/** The map builder, coming back to `returnTo` (the vendor flow's Floor map step) on Back and Done. */
export const builderHref = (mapId: string, returnTo: string) => `/admin/maps/${mapId}?returnTo=${encodeURIComponent(returnTo)}`;

export function MapSummary({ map, returnTo, headingRef }: { map: AdminMapDetail; returnTo: string; headingRef: Ref<HTMLHeadingElement> }) {
  const bound = map.tiers.filter((t) => map.booths.some((b) => b.tierId === t.id));
  const unpriced = map.booths.filter((b) => !b.tierId).length;
  const published = map.status === 'PUBLISHED';
  return (
    <section aria-labelledby="setup-map-title" className={card} data-testid="setup-map-summary">
      <h2 ref={headingRef} tabIndex={-1} id="setup-map-title" className="flex flex-wrap items-center gap-2 text-base font-semibold text-gray-900 focus:outline-none dark:text-white">
        <span className="min-w-0 break-words">{map.name}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${published ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300' : 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200'}`}>
          {published ? 'Published' : 'Draft'}
        </span>
      </h2>
      <dl className="mt-3 grid gap-2 text-sm text-gray-700 dark:text-slate-300 sm:grid-cols-[auto_1fr] sm:gap-x-4">
        <dt className="font-medium text-gray-900 dark:text-white">Booths</dt>
        <dd>{map.booths.length ? `${plural(map.booths.length, 'booth')}${unpriced ? `, ${unpriced} without a tier` : ''}` : 'No booths yet'}</dd>
        <dt className="font-medium text-gray-900 dark:text-white">Tiers on the map</dt>
        <dd>{bound.length ? bound.map((t) => t.name).join(', ') : 'None yet: give booths a tier in the builder so vendors can buy them'}</dd>
      </dl>
      <Link href={builderHref(map.id, returnTo)} className={`${primaryButton} mt-4 w-full sm:w-auto`}>
        <MapIcon className="h-4 w-4" aria-hidden />
        Open map builder
      </Link>
    </section>
  );
}

interface NewMapProps {
  plans: FloorPlanSummary[];
  busy: string | null;
  onCreate: (templateId: string | null) => void;
}

export function NewMap({ plans, busy, onCreate }: NewMapProps) {
  return (
    <section aria-labelledby="setup-map-title" className={card}>
      <h2 id="setup-map-title" className="text-base font-semibold text-gray-900 dark:text-white">Create the floor map</h2>
      <p className="mt-1 text-sm text-gray-700 dark:text-slate-300">
        The map is optional. Draw the floor and place booths, and approved vendors pick their own spot on it.
      </p>
      <button type="button" onClick={() => onCreate(null)} disabled={!!busy} aria-busy={busy === 'blank'} className={`${primaryButton} mt-4 w-full sm:w-auto`}>
        <Plus className="h-4 w-4" aria-hidden />
        {busy === 'blank' ? 'Creating…' : 'Create a blank map'}
      </button>
      <h3 className="mt-6 text-sm font-semibold text-gray-900 dark:text-white">Start from a floor plan</h3>
      {plans.length ? (
        <ul className="mt-2 space-y-2">
          {plans.map((plan) => (
            <li key={plan.id}>
              <button type="button" onClick={() => onCreate(plan.id)} disabled={!!busy} aria-busy={busy === plan.id} className={`${secondaryButton} w-full justify-start text-left`}>
                <LayoutTemplate className="h-4 w-4 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1 truncate">
                  <span className="sr-only">Use floor plan </span>
                  {plan.name}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-gray-600 dark:text-slate-400">{plural(plan.boothCount, 'booth')}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
          No saved floor plans yet. In any map, choose Save as floor plan to reuse its layout here.
        </p>
      )}
    </section>
  );
}
