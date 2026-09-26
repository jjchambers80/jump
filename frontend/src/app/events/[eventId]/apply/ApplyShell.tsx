'use client';

// Shared frame for the public apply pages (spec 011): loads the event for
// branding, renders the organizer header and a hero in the event page's
// language (blurred poster, date tile, venue block) with a back link.
// Children receive the event once loaded.

import Link from 'next/link';
import { ReactNode, useEffect, useState } from 'react';
import { ArrowLeft, CalendarDays, MapPin } from 'lucide-react';
import api from '@/services/api';
import BrandScope from '@/components/BrandScope';
import OrganizationHeader from '@/components/OrganizationHeader';
import type { ThemeMode } from '@/lib/theme';
import StorefrontPasswordGate from '@/components/StorefrontPasswordGate';
import { storefrontLockFrom, type StorefrontLock } from '@/lib/storefrontAccess';
import { formatEventDate, formatEventTime } from '@/lib/eventTime';
import { dateTile } from '@/lib/dateTile';
import { resolveAssetUrl } from '@/lib/assets';

export interface ApplyEvent {
  id: string;
  name: string;
  date: string;
  status: string;
  logoUrl?: string | null;
  organizationId?: string | null;
  organizationName?: string | null;
  organizationLogoUrl?: string | null;
  organizationBrandColor?: string | null;
  organizationThemeMode?: ThemeMode | null;
  venue: { name: string; city?: string | null; state?: string | null; timezone?: string | null } | null;
}

interface ApplyShellProps {
  eventId: string;
  title?: string;
  /** Small label over the title ("Application", "Get involved"). */
  kicker?: string;
  /** `wide` makes room for the form's sticky summary column. */
  width?: 'narrow' | 'wide';
  children: (event: ApplyEvent) => ReactNode;
}

export default function ApplyShell({ eventId, title, kicker = 'Get involved', width = 'narrow', children }: ApplyShellProps) {
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
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-8 max-w-md w-full text-center">
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

  const zone = event.venue?.timezone;
  const tile = dateTile(event.date, zone);
  const poster = resolveAssetUrl(event.logoUrl);
  const container = width === 'wide' ? 'max-w-6xl' : 'max-w-3xl';
  const place = event.venue ? [event.venue.city, event.venue.state].filter(Boolean).join(', ') : '';

  return (
    <BrandScope color={event.organizationBrandColor} themeMode={event.organizationThemeMode} className="min-h-screen bg-gray-50 dark:bg-slate-900">
      {event.organizationName && (
        <OrganizationHeader
          organization={{ id: event.organizationId, name: event.organizationName, logoUrl: event.organizationLogoUrl }}
        />
      )}

      {/* Hero: the event this application belongs to */}
      <div className="relative overflow-hidden bg-slate-900" data-testid="apply-hero">
        {poster && (
          <div
            aria-hidden
            className="absolute inset-0 bg-cover bg-center opacity-60"
            style={{ backgroundImage: `url(${poster})`, filter: 'blur(32px) saturate(1.2)', transform: 'scale(1.2)' }}
          />
        )}
        <div aria-hidden className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/70 to-black/45" />
        {/* A thin brand rule where the hero meets the page */}
        <div aria-hidden className="absolute inset-x-0 bottom-0 h-1 bg-brand" />

        <div className={`relative mx-auto ${container} px-4 pb-9 pt-6 sm:px-6 sm:pb-12 sm:pt-8`}>
          <Link
            href={`/events/${event.id}`}
            className="inline-flex items-center gap-1.5 rounded-full py-1 pr-2 text-sm font-semibold text-gray-300 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back to {event.name}
          </Link>

          <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="inline-block rounded-full bg-white/15 px-3 py-1 text-xs font-semibold text-white ring-1 ring-inset ring-white/20 backdrop-blur-sm">
              {kicker}
            </span>
            {event.organizationName && (
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-300">{event.organizationName}</p>
            )}
          </div>
          <h1 className="mt-3 text-balance text-3xl font-extrabold leading-[1.05] tracking-tight text-white sm:text-[2.6rem]">
            {title ?? `Get involved with ${event.name}`}
          </h1>

          <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-8">
            <div className="flex items-center gap-3">
              {tile ? (
                <div
                  aria-hidden
                  className="flex w-12 shrink-0 flex-col items-center rounded-xl bg-white/10 py-1 text-white ring-1 ring-inset ring-white/20 backdrop-blur-sm"
                >
                  <span className="text-[9px] font-bold uppercase tracking-[0.16em] opacity-80">{tile.month}</span>
                  <span className="text-lg font-extrabold leading-none tabular-nums">{tile.day}</span>
                </div>
              ) : (
                <CalendarDays className="h-5 w-5 shrink-0 text-gray-200" aria-hidden />
              )}
              <div className="leading-snug">
                <p className="text-sm font-semibold text-white">{event.name}</p>
                <p className="text-sm text-gray-300">
                  {formatEventDate(event.date, zone)} · {formatEventTime(event.date, zone)}
                </p>
              </div>
            </div>

            {event.venue && (
              <div className="flex items-center gap-3">
                <div
                  aria-hidden
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white ring-1 ring-inset ring-white/20 backdrop-blur-sm"
                >
                  <MapPin className="h-5 w-5" />
                </div>
                <div className="min-w-0 leading-snug">
                  <p className="text-sm font-semibold text-white">{event.venue.name}</p>
                  {place && <p className="text-sm text-gray-300">{place}</p>}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <main className={`mx-auto ${container} px-4 py-8 sm:px-6 sm:py-10`}>{children(event)}</main>
    </BrandScope>
  );
}
