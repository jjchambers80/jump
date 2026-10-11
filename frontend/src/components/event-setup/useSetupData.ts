'use client';

// Loads what the wizard needs: the organization's venues and, on an existing
// event, its overview (GET …/overview, which carries setupStep and
// setupCompletedAt). Fetches only after the org context settles and refetches
// on an org change, not on loading toggles (frontend AGENTS › Org switcher).

import { useCallback, useEffect, useState } from 'react';
import api from '@/services/api';
import type { EventOverview, OverviewEvent } from '@/lib/eventOverview';
import type { SavedEvent } from './steps';
import type { SetupVenue } from './steps/types';

export type LoadState = { status: 'loading' } | { status: 'error'; code: number; message: string } | { status: 'ready' };

export function toSaved(event: OverviewEvent): SavedEvent {
  return {
    id: event.id,
    name: event.name,
    slug: event.slug,
    venueId: event.venue?.id ?? '',
    date: event.date ?? null,
    endDate: event.endDate ?? null,
    status: event.status,
    admissionMode: event.admissionMode ?? 'TICKETED',
    setupStep: event.setupStep ?? null,
    setupCompletedAt: event.setupCompletedAt ?? null,
    description: event.description,
    logoUrl: event.logoUrl,
    capacity: event.capacity,
    tierCount: event.priceTiers?.length ?? 0,
    category: event.category ?? null,
    rsvpLimit: event.rsvpLimit ?? null,
    rsvpMaxPartySize: event.rsvpMaxPartySize ?? 1,
    tiers: [...(event.priceTiers ?? [])].sort((a, b) => a.displayOrder - b.displayOrder),
    tax: event.tax,
    taxInclusive: event.taxInclusivePricing === true,
  };
}

/**
 * The admission lock (spec 034 D11, mirrored from EventService.updateEvent):
 * ticketed stays ticketed once anything was ordered, RSVP stays RSVP while
 * anyone is going. The backend still refuses with 409 ADMISSION_MODE_LOCKED.
 */
export function admissionLockFrom(overview: EventOverview): string | null {
  const { event } = overview;
  if (event.admissionMode === 'RSVP')
    return (overview.rsvp?.going ?? 0) > 0 ? 'People have RSVP\'d, so this event stays RSVP.' : null;
  const ordered =
    (overview.money?.tickets?.orders ?? 0) > 0 ||
    (overview.tickets?.issued ?? 0) > 0 ||
    (event.priceTiers ?? []).some((t) => t.quantitySold + (t.quantityReserved ?? 0) > 0);
  return ordered ? 'Tickets have been ordered, so this event stays ticketed.' : null;
}

export function useSetupData(orgId: string | null, orgLoading: boolean, eventId: string | null) {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [venues, setVenues] = useState<SetupVenue[]>([]);
  const [saved, setSaved] = useState<SavedEvent | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (orgLoading || !orgId) return;
    let cancelled = false;
    setLoad({ status: 'loading' });
    Promise.all([
      api.get<SetupVenue[]>(`/organizations/${orgId}/venues`),
      eventId ? api.get<EventOverview>(`/organizations/${orgId}/events/${eventId}/overview`) : Promise.resolve(null),
    ])
      .then(([venueList, overview]) => {
        if (cancelled) return;
        setVenues(venueList);
        setSaved(overview ? { ...toSaved(overview.event), admissionLock: admissionLockFrom(overview) } : null);
        setLoad({ status: 'ready' });
      })
      .catch((err) => {
        if (cancelled) return;
        setLoad({ status: 'error', code: err?.status ?? 0, message: err?.message || 'Request failed' });
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, orgLoading, eventId, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const addVenue = useCallback((venue: SetupVenue) => setVenues((list) => [...list, venue]), []);

  return { load, venues, saved, setSaved, reload, addVenue };
}
