'use client';

// Shared frame for the public apply pages (spec 011): loads the event for
// branding, renders the organizer header and a back link. Children receive
// the event once loaded.

import Link from 'next/link';
import { ReactNode, useEffect, useState } from 'react';
import api from '@/services/api';
import BrandScope from '@/components/BrandScope';
import OrganizationHeader from '@/components/OrganizationHeader';
import type { ThemeMode } from '@/lib/theme';
import { formatDate } from '@/lib/applications';
import StorefrontPasswordGate from '@/components/StorefrontPasswordGate';
import { storefrontLockFrom, type StorefrontLock } from '@/lib/storefrontAccess';
import { formatEventDate } from '@/lib/eventTime';

export interface ApplyEvent {
  id: string;
  name: string;
  date: string;
  status: string;
  organizationId?: string | null;
  organizationName?: string | null;
  organizationLogoUrl?: string | null;
  organizationBrandColor?: string | null;
  organizationThemeMode?: ThemeMode | null;
  venue: { name: string; city?: string | null; state?: string | null; timezone?: string | null } | null;
}

export default function ApplyShell({ eventId, title, children }: { eventId: string; title?: string; children: (event: ApplyEvent) => ReactNode }) {
  const [event, setEvent] = useState<ApplyEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lock, setLock] = useState<StorefrontLock | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api
      .get<ApplyEvent>(`/events/${eventId}`)
      .then((e) => {
        if (!cancelled) {
          setEvent(e);
          setLock(null);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        const locked = storefrontLockFrom(err);
        if (locked) setLock(locked);
        else setError(err?.message || 'Event not found');
      });
    return () => {
      cancelled = true;
    };
  }, [eventId, attempt]);

  if (lock) {
    return (
      <StorefrontPasswordGate
        organization={lock.organization}
        message={lock.message}
        onUnlocked={() => setAttempt((n) => n + 1)}
      />
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-slate-900 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md p-8 max-w-md w-full text-center">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-slate-100 mb-2">Event not found</h2>
          <p className="text-gray-600 dark:text-slate-400">{error}</p>
        </div>
      </div>
    );
  }
  if (!event) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-slate-900 flex items-center justify-center">
        <p className="text-gray-600 dark:text-slate-400">Loading…</p>
      </div>
    );
  }

  return (
    <BrandScope color={event.organizationBrandColor} themeMode={event.organizationThemeMode} className="min-h-screen bg-gray-50 dark:bg-slate-900">
      {event.organizationName && (
        <OrganizationHeader
          organization={{ id: event.organizationId, name: event.organizationName, logoUrl: event.organizationLogoUrl }}
        />
      )}
      <main className="max-w-3xl mx-auto px-4 py-8 sm:py-10">
        <Link href={`/events/${event.id}`} className="inline-flex items-center text-brand-link hover:opacity-80 font-semibold text-sm">
          ← Back to {event.name}
        </Link>
        <header className="mt-4 mb-6">
          <p className="text-sm text-gray-600 dark:text-slate-400">
            {event.organizationName ? `${event.organizationName} · ` : ''}
            {formatEventDate(event.date, event.venue?.timezone)}
            {event.venue ? ` · ${event.venue.name}` : ''}
          </p>
          <h1 className="mt-1 text-2xl sm:text-3xl font-bold text-gray-900 dark:text-slate-100">{title ?? `Get involved with ${event.name}`}</h1>
        </header>
        {children(event)}
      </main>
    </BrandScope>
  );
}
