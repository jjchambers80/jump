'use client';

// Loads what the wizard needs: the organization's venues and, on an existing
// event, its overview (GET …/overview, which carries setupStep and
// setupCompletedAt). Fetches only after the org context settles and refetches
// on an org change, not on loading toggles (frontend AGENTS › Org switcher).

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import api from '@/services/api';
import type { EventOverview, OverviewEvent } from '@/lib/eventOverview';
import type { SavedEvent } from './steps';
import type { SetupVenue } from './steps/types';

export type LoadState = { status: 'loading' } | { status: 'error'; code: number; message: string } | { status: 'ready' };

export function toSaved(event: OverviewEvent, addOnCount?: number): SavedEvent {
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
    ...(addOnCount !== undefined && { addOnCount }),
  };
}


export function useSetupData(orgId: string | null, orgLoading: boolean, eventId: string | null) {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [venues, setVenues] = useState<SetupVenue[]>([]);
  const [saved, setSavedRaw] = useState<SavedEvent | null>(null);
  // An event PATCH answers without add-ons or the map: keep what the overview gave.
  const setSaved = useCallback<Dispatch<SetStateAction<SavedEvent | null>>>(
    (action) =>
      setSavedRaw((prev) => {
        const next = typeof action === 'function' ? action(prev) : action;
        if (!next || prev?.id !== next.id) return next;
        return {
          ...next,
          ...(next.addOnCount === undefined && { addOnCount: prev.addOnCount }),
          ...(next.mapStatus === undefined && { mapStatus: prev.mapStatus }),
        };
      }),
    []
  );
  const setAddOnCount = useCallback((addOnCount: number) => setSavedRaw((prev) => (prev ? { ...prev, addOnCount } : prev)), []);
  const setMapStatus = useCallback((mapStatus: SavedEvent['mapStatus']) => setSavedRaw((prev) => (prev ? { ...prev, mapStatus } : prev)), []);
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
        setSaved(overview ? { ...toSaved(overview.event, overview.addOns?.addOns?.length ?? 0), mapStatus: overview.map?.status ?? null, admissionLock: overview.admissionLock?.reason ?? null } : null);
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
  // The address step can hand back a venue already in the list (same address).
  const addVenue = useCallback((venue: SetupVenue) => setVenues((list) => [...list.filter((v) => v.id !== venue.id), venue]), []);

  return { load, venues, saved, setSaved, setAddOnCount, setMapStatus, reload, addVenue };
}
