'use client';

// Step 7, Collect more (spec 050 §5.1, card 050-K). Add-ons for any event
// (RSVP too since 050-O: vendor tiers offer them) through the shared AddOnsSection: saved add-on picker (create in
// place), price, quantity, tiers, reorder, activate. Each add-on saves on its
// own dialog (§11.5); `onSaved` gets the new add-on count, which marks the
// step complete, and bumps the preview revision.
//
// Tiers and the tax rate are read fresh on entry: the Tickets step may have
// just changed them.

import { useCallback, useEffect, useState } from 'react';
import api from '@/services/api';
import AddOnsSection from '@/components/events/add-ons/AddOnsSection';
import type { EventOverview } from '@/lib/eventOverview';
import { secondaryButton } from '../ui';

interface Props {
  orgId: string;
  eventId: string;
  onSaved: (addOnCount: number) => void;
}

type Pricing = { tiers: { id: string; name: string }[]; taxRate: number; taxInclusive: boolean };

export default function CollectMoreStep({ orgId, eventId, onSaved }: Props) {
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api
      .get<EventOverview>(`/organizations/${orgId}/events/${eventId}/overview`)
      .then(({ event }) =>
        setPricing({
          tiers: (event.priceTiers ?? []).map((t) => ({ id: t.id, name: t.name })),
          taxRate: event.tax?.rate ?? 0,
          taxInclusive: event.taxInclusivePricing === true,
        })
      )
      .catch((err) => setError(err?.message || 'Request failed'));
  }, [orgId, eventId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      {error && (
        <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
          <p>Couldn&apos;t load this event&apos;s tickets: {error}</p>
          <button type="button" onClick={load} className={`mt-3 ${secondaryButton}`}>
            Try again
          </button>
        </div>
      )}
      {!pricing && !error && (
        <div aria-busy="true" aria-label="Loading add-ons" className="space-y-3">
          <div className="h-6 w-1/3 animate-pulse rounded bg-gray-200 dark:bg-slate-700" />
          <div className="h-11 animate-pulse rounded-md bg-gray-200 dark:bg-slate-700" />
          <div className="h-20 animate-pulse rounded-lg bg-gray-200 dark:bg-slate-700" />
        </div>
      )}
      {pricing && (
        <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900 sm:p-6">
          <AddOnsSection
            orgId={orgId}
            eventId={eventId}
            priceTiers={pricing.tiers}
            taxRate={pricing.taxRate}
            taxInclusive={pricing.taxInclusive}
            onChange={(list) => onSaved(list.length)}
          />
        </section>
      )}
      {/*
        Spec 047 D1 mount point (plan-d1 §0.1): D1-G renders
        <EventGiftSettings orgId={orgId} eventId={eventId} onSaved={…} />
        here when useDonationsEligible() is true. Its gift fields ride on the
        event PATCH.
      */}
    </div>
  );
}
