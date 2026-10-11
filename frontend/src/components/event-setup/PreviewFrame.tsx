'use client';

// Chrome-less preview document inside the wizard's iframe (spec 050 §8.3).
// Listens for the parent's messages (same origin, from window.parent only),
// loads the saved event once per event id (GET …/preview-payload) and renders
// EventPageView in preview mode with the unsaved overlay on top. Scrolling to
// a step's section happens in this document's own window, never the admin's.

import { useEffect, useRef, useState } from 'react';
import api from '@/services/api';
import EventPageView from '@/app/events/[eventId]/EventPageView';
import { orgFromEvent, type EventPageEvent } from '@/app/events/[eventId]/eventPage';
import { useOrg } from '@/components/OrgContext';
import {
  PREVIEW_READY,
  applyOverlay,
  blankPreviewEvent,
  isPreviewMessage,
  trustedMessage,
  type PreviewMessage,
  type PreviewOverlay,
} from './previewMessages';

function scrollToAnchor(anchor: string) {
  const target = document.getElementById(anchor) ?? document.getElementById('event-hero');
  if (!target) return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const top = target.getBoundingClientRect().top + window.scrollY - 16;
  window.scrollTo({ top: Math.max(0, top), behavior: reduced ? 'auto' : 'smooth' });
}

export default function PreviewFrame() {
  const { selectedOrg } = useOrg();
  const [message, setMessage] = useState<PreviewMessage | null>(null);
  const [saved, setSaved] = useState<{ id: string; revision: number; event: EventPageEvent | null } | null>(null);
  const [carried, setCarried] = useState<PreviewOverlay>({});
  const lastAnchor = useRef<string | null>(null);
  const lastMessage = useRef<PreviewMessage | null>(null);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!trustedMessage(event, window.parent) || !isPreviewMessage(event.data)) return;
      const next = event.data;
      // A save bumps the revision and drops the saved values from the overlay:
      // keep the previous overlay until the reload arrives, so nothing flashes back.
      const prev = lastMessage.current;
      if (prev && next.revision > prev.revision) setCarried(prev.overlay);
      lastMessage.current = next;
      setMessage(next);
    };
    window.addEventListener('message', onMessage);
    window.parent.postMessage({ type: PREVIEW_READY }, window.location.origin);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const eventId = message?.eventId ?? null;
  const orgId = message?.orgId ?? null;
  const revision = message?.revision ?? 0;
  useEffect(() => {
    if (!eventId || !orgId) return;
    let cancelled = false;
    api
      .get<{ event: EventPageEvent }>(`/organizations/${orgId}/events/${eventId}/preview-payload`)
      .then((payload) => {
        if (cancelled) return;
        setSaved({ id: eventId, revision, event: payload.event });
      })
      // The overlay alone still renders when the saved event cannot load.
      .catch(() => !cancelled && setSaved({ id: eventId, revision, event: null }));
    return () => {
      cancelled = true;
    };
  }, [eventId, orgId, revision]);

  const anchor = message?.anchor ?? null;
  const ready = !!message && (!eventId || saved?.id === eventId);
  useEffect(() => {
    if (!ready || !anchor || anchor === lastAnchor.current) return;
    lastAnchor.current = anchor;
    // After the view has laid out the overlay.
    requestAnimationFrame(() => scrollToAnchor(anchor));
  }, [ready, anchor]);

  if (!message || !ready) {
    return (
      <div aria-busy="true" aria-label="Loading preview" className="min-h-screen bg-gray-50 p-4 dark:bg-slate-900">
        <div className="h-56 animate-pulse rounded-lg bg-gray-200 dark:bg-slate-800" />
        <div className="mt-4 h-6 w-2/3 animate-pulse rounded bg-gray-200 dark:bg-slate-800" />
        <div className="mt-2 h-4 w-1/2 animate-pulse rounded bg-gray-200 dark:bg-slate-800" />
      </div>
    );
  }

  const base: EventPageEvent = saved?.event ?? {
    ...blankPreviewEvent(),
    organizationId: selectedOrg?.id ?? null,
    organizationName: selectedOrg?.name ?? null,
    organizationLogoUrl: selectedOrg?.logoUrl ?? null,
    organizationBrandColor: selectedOrg?.brandColor ?? null,
    organizationThemeMode: selectedOrg?.themeMode ?? null,
    organizationSignInLinks: false,
  };
  const stale = !!saved && saved.revision < message.revision;
  const event = applyOverlay(base, stale ? { ...carried, ...message.overlay } : message.overlay);

  return <EventPageView event={event} org={orgFromEvent(event)} preview />;
}
