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
  };
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
        setSaved(overview ? toSaved(overview.event) : null);
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
