'use client';

// Venue Details — the venue's read-only home in the admin, the same shape as
// Event Details (spec 037): every section shows what is set and links to the
// one place it is edited. This page writes nothing except Delete, which the
// backend refuses while events still use the venue.
// One request: GET /organizations/:orgId/venues/:id (venue + its events).

import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowUpRight,
  CalendarDays,
  ChevronRight,
  Clock,
  Copy,
  ExternalLink,
  MapPin,
  Navigation,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import api from '@/services/api';
import { useOrg } from '@/components/OrgContext';
import { imageVariantUrl } from '@/lib/assets';
import { formatEventDate, formatEventDateTime, zoneAbbreviation } from '@/lib/eventTime';
import { timeZoneLabel } from '@/lib/timeZones';
import { useAccountFormat } from '@/lib/accountFormat';
import { EventStatusPill, Perforation } from '@/components/events/EventEditSummary';
import { Empty, Facts, OverviewSection } from '@/components/events/EventOverviewSections';
import VisibilityBadge from '@/components/venues/VisibilityBadge';
import {
  TIME_ZONE_SOURCE_LABEL,
  type AdminVenueDetails,
  type VenueEvent,
  venueLocality,
  venueMapsHref,
  venueMonogram,
  venuePublicPath,
} from '@/lib/venues';

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-900';
const secondaryButton = `inline-flex min-h-11 items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 text-sm font-semibold text-gray-800 hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700 sm:min-h-9 ${focusRing}`;
const quietLink = `inline-flex items-center gap-1 rounded text-sm font-medium text-accent-700 hover:underline dark:text-accent-300 ${focusRing}`;

function VenueDetailsContent() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const venueId = params.venueId as string;
  const { selectedOrgId, loading: orgLoading } = useOrg();
  const orgId = selectedOrgId || searchParams.get('orgId');

  const [venue, setVenue] = useState<AdminVenueDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(searchParams.get('notice'));
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    if (orgLoading || !orgId || !venueId) return;
    try {
      setError(null);
      setVenue(await api.get<AdminVenueDetails>(`/organizations/${orgId}/venues/${venueId}`));
    } catch (err: any) {
      setVenue(null);
      setError(err?.status === 404 ? 'This venue is not in the selected organization.' : err?.message || 'Failed to load the venue');
    } finally {
      setLoading(false);
    }
  }, [orgLoading, orgId, venueId]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  if (orgLoading || (orgId && loading)) return <DetailsSkeleton />;

  if (!orgId) {
    return (
      <PageFrame>
        <p className="text-sm text-gray-600 dark:text-slate-400">Choose an organization to see this venue.</p>
      </PageFrame>
    );
  }

  if (!venue) {
    return (
      <PageFrame>
        <Breadcrumb />
        <div role="alert" className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
          {error || 'Venue not found'}
        </div>
      </PageFrame>
    );
  }

  const q = searchParams.get('orgId') ? `?orgId=${encodeURIComponent(orgId)}` : '';
  const editHref = (section?: string) => `/admin/venues/${venue.id}/edit${q}${section ? `#${section}` : ''}`;
  const publicPath = venuePublicPath(venue);

  const copyLink = async () => {
    const url = `${window.location.origin}${publicPath}`;
    try {
      await navigator.clipboard.writeText(url);
      setNotice('Link copied.');
    } catch {
      window.prompt('Copy the venue link', url);
    }
  };

  return (
    <PageFrame>
      <Breadcrumb name={venue.name} />

      <VenueHero
        venue={venue}
        publicPath={publicPath}
        actions={
          <>
            {venue.isPublic && (
              <a href={publicPath} target="_blank" rel="noreferrer" className={secondaryButton}>
                View page
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            )}
            <Link
              href={editHref()}
              className={`inline-flex min-h-11 items-center gap-1.5 rounded-md bg-accent-500 px-3 text-sm font-semibold text-gray-950 shadow-sm hover:bg-accent-hover sm:min-h-9 ${focusRing}`}
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden />
              Edit venue
            </Link>
          </>
        }
      />

      {(notice || error) && (
        <p
          role="status"
          className={`mt-4 rounded-lg px-4 py-2.5 text-sm ${
            error
              ? 'bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-200'
              : 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'
          }`}
        >
          {error || notice}
        </p>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0 space-y-6">
          <EventsSection venue={venue} orgQuery={q} />
        </div>
        <aside className="min-w-0 space-y-6" aria-label="Venue settings">
          <OverviewSection id="venue-location" title="Location" editHref={editHref('venue-location')} editLabel="Edit location" delay={60}>
            <Facts
              rows={[
                ['Street', venue.address],
                ['City', venue.city || <Unset />],
                ['State', venue.state || <Unset />],
                ['Postal code', venue.postalCode || <Unset />],
                ['Country', venue.country || 'US'],
              ]}
            />
            <a href={venueMapsHref(venue)} target="_blank" rel="noreferrer" className={`${quietLink} mt-4`}>
              <Navigation className="h-3.5 w-3.5" aria-hidden />
              Open in Google Maps
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </OverviewSection>

          <OverviewSection id="venue-time-zone" title="Time zone" editHref={editHref('venue-location')} editLabel="Edit time zone" delay={100}>
            <p className="flex items-start gap-2 text-sm font-medium text-gray-900 dark:text-slate-100">
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-gray-400 dark:text-slate-500" aria-hidden />
              {timeZoneLabel(venue.timezone)}
            </p>
            <p className="mt-1 pl-6 text-xs text-gray-600 dark:text-slate-400">
              {TIME_ZONE_SOURCE_LABEL[venue.timezoneSource ?? 'DEFAULT']}. Event times at this venue print on this clock for every viewer.
            </p>
          </OverviewSection>

          <OverviewSection id="venue-visibility" title="Public page" editHref={editHref('venue-visibility')} editLabel="Edit public page" delay={140}>
            <Facts
              rows={[
                ['Visibility', <VisibilityBadge key="v" isPublic={venue.isPublic} />],
                ['URL', <span key="u" className="break-all font-mono text-xs">{publicPath}</span>],
              ]}
            />
            <p className="mt-3 text-xs text-gray-600 dark:text-slate-400">
              {venue.isPublic
                ? 'Anyone can open this page; it lists the published events held here.'
                : 'The public URL returns not found. Events here still sell on their own pages.'}
            </p>
            {venue.isPublic && (
              <button type="button" onClick={copyLink} className={`${quietLink} mt-3`}>
                <Copy className="h-3.5 w-3.5" aria-hidden />
                Copy link
              </button>
            )}
          </OverviewSection>

          <RecordCard venue={venue} />

          <DangerZone venue={venue} onDelete={() => setDeleting(true)} />
        </aside>
      </div>

      {deleting && (
        <DeleteVenueDialog
          venueName={venue.name}
          onClose={() => setDeleting(false)}
          onConfirm={async () => {
            await api.delete(`/organizations/${orgId}/venues/${venue.id}`);
            const params = new URLSearchParams(q.slice(1));
            params.set('notice', `${venue.name} deleted.`);
            router.push(`/admin/venues?${params.toString()}`);
          }}
        />
      )}
    </PageFrame>
  );
}

function Unset() {
  return <span className="font-normal text-gray-500 dark:text-slate-400">Not set</span>;
}

function PageFrame({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-screen-2xl px-4 py-6 sm:px-6 sm:py-8">{children}</div>;
}

function Breadcrumb({ name }: { name?: string }) {
  return (
    <nav aria-label="Breadcrumb" className="text-sm">
      <ol className="flex min-w-0 items-center gap-1 text-gray-600 dark:text-slate-400">
        <li>
          <Link href="/admin/venues" className={`rounded font-medium hover:text-gray-900 dark:hover:text-white ${focusRing}`}>
            Venues
          </Link>
        </li>
        {name && (
          <>
            <li aria-hidden>
              <ChevronRight className="h-3.5 w-3.5" />
            </li>
            <li aria-current="page" className="min-w-0 truncate text-gray-900 dark:text-slate-200">
              {name}
            </li>
          </>
        )}
      </ol>
    </nav>
  );
}

function splitEvents(events: VenueEvent[]) {
  const now = Date.now();
  const upcoming = events.filter((e) => new Date(e.date).getTime() >= now && e.status !== 'CANCELLED').reverse();
  const past = events.filter((e) => !upcoming.includes(e));
  return { upcoming, past };
}

/** Logo and identity above the tear line, the venue's numbers below it. */
function VenueHero({ venue, publicPath, actions }: { venue: AdminVenueDetails; publicPath: string; actions: React.ReactNode }) {
  const logo = imageVariantUrl(venue.logoUrl, 'thumb');
  const locality = venueLocality(venue);
  const { upcoming } = splitEvents(venue.events);
  const next = upcoming[0];
  const published = venue.events.filter((e) => e.status === 'PUBLISHED').length;

  const stats: { label: string; value: string; detail?: string }[] = [
    { label: 'Events', value: String(venue.events.length), detail: `${published} published` },
    { label: 'Upcoming', value: String(upcoming.length), detail: upcoming.length ? 'Not cancelled' : 'None scheduled' },
    {
      label: 'Next event',
      value: next ? formatEventDate(next.date, venue.timezone).replace(/^\w+, /, '') : '—',
      detail: next ? next.name : 'Nothing on the calendar',
    },
    { label: 'Time zone', value: zoneAbbreviation(new Date(), venue.timezone) || '—', detail: timeZoneLabel(venue.timezone) },
  ];

  return (
    <section
      aria-labelledby="venue-title"
      className="relative mt-4 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm shadow-gray-900/[0.04] motion-safe:animate-card-in dark:border-slate-700/80 dark:bg-slate-800 dark:shadow-none"
    >
      {/* Contour lines: a quiet map texture behind the identity row. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-44 overflow-hidden">
        <div className="h-full w-full opacity-60 [background-image:repeating-radial-gradient(circle_at_85%_-10%,transparent_0_18px,rgb(99_102_241/0.07)_18px_19px)] dark:opacity-100" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-white dark:to-slate-800" />
      </div>

      <div className="relative flex flex-col gap-5 p-5 sm:p-6 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 gap-4 sm:gap-5">
          <div className="relative shrink-0">
            <div className="h-16 w-16 overflow-hidden rounded-xl bg-accent-50 ring-1 ring-inset ring-black/5 dark:bg-slate-700/60 dark:ring-white/10 sm:h-28 sm:w-28">
              {logo ? (
                <img src={logo} alt={`${venue.name} logo`} className="h-full w-full bg-white object-contain p-1.5" />
              ) : (
                <div aria-hidden className="flex h-full w-full items-center justify-center [background-image:repeating-linear-gradient(135deg,rgb(99_102_241/0.10)_0_1px,transparent_1px_7px)]">
                  <span className="select-none text-3xl font-black tracking-tighter text-accent-600/70 dark:text-accent-300/50 sm:text-5xl">{venueMonogram(venue.name)}</span>
                </div>
              )}
            </div>
            <div aria-hidden className="absolute -bottom-2 -right-2 flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-white shadow-md dark:border-slate-600 dark:bg-slate-900 sm:-bottom-3 sm:-right-3 sm:h-10 sm:w-10">
              <MapPin className="h-4 w-4 text-accent-700 dark:text-accent-300 sm:h-5 sm:w-5" />
            </div>
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <VisibilityBadge isPublic={venue.isPublic} />
              <span className="text-xs font-medium text-gray-600 dark:text-slate-400">
                {venue.events.length} event{venue.events.length === 1 ? '' : 's'}
              </span>
            </div>
            <h1 id="venue-title" className="mt-1.5 text-2xl font-bold tracking-tight text-gray-900 [overflow-wrap:anywhere] dark:text-white sm:text-3xl">
              {venue.name}
            </h1>
            <address className="mt-2 flex items-start gap-1.5 text-sm not-italic text-gray-700 dark:text-slate-300">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-gray-400 dark:text-slate-500" aria-hidden />
              <span className="min-w-0 [overflow-wrap:anywhere]">
                {venue.address}
                {locality && <>, {locality}</>}
              </span>
            </address>
            <p className="mt-1 truncate font-mono text-xs text-gray-500 dark:text-slate-400">{publicPath}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:justify-end">{actions}</div>
      </div>

      <Perforation />

      <dl className="relative grid grid-cols-2 lg:grid-cols-4">
        {stats.map((s, i) => (
          <div
            key={s.label}
            className={`min-w-0 px-5 py-4 sm:px-6 ${i % 2 === 1 ? 'border-l border-gray-100 dark:border-slate-700/70' : ''} ${
              i >= 2 ? 'border-t border-gray-100 dark:border-slate-700/70 lg:border-t-0' : ''
            } ${i === 2 ? 'lg:border-l' : ''}`}
          >
            <dt className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-gray-600 dark:text-slate-400">{s.label}</dt>
            <dd className="mt-1 min-w-0">
              <span className="block text-xl font-semibold tabular-nums tracking-tight text-gray-900 [overflow-wrap:anywhere] dark:text-white sm:text-2xl">{s.value}</span>
              {s.detail && <span className="block text-xs text-gray-600 [overflow-wrap:anywhere] dark:text-slate-400">{s.detail}</span>}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function EventsSection({ venue, orgQuery }: { venue: AdminVenueDetails; orgQuery: string }) {
  const { upcoming, past } = splitEvents(venue.events);
  return (
    <OverviewSection
      id="venue-events"
      title="Events at this venue"
      delay={40}
      flush={venue.events.length > 0}
      aside={
        <Link href="/admin/events/new" className={quietLink}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Create event
        </Link>
      }
    >
      {venue.events.length === 0 ? (
        <Empty>No events here yet. Pick this venue when you create one.</Empty>
      ) : (
        <>
          <EventGroup title="Upcoming" events={upcoming} zone={venue.timezone} orgQuery={orgQuery} empty="Nothing scheduled." />
          {past.length > 0 && <EventGroup title="Past and cancelled" events={past} zone={venue.timezone} orgQuery={orgQuery} />}
        </>
      )}
    </OverviewSection>
  );
}

function EventGroup({
  title,
  events,
  zone,
  orgQuery,
  empty,
}: {
  title: string;
  events: VenueEvent[];
  zone: string;
  orgQuery: string;
  empty?: string;
}) {
  const id = `venue-events-${title.split(' ')[0].toLowerCase()}`;
  return (
    <div className="border-t border-gray-100 first:border-t-0 dark:border-slate-700/70">
      <h3 id={id} className="px-5 pb-1 pt-3 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-gray-600 dark:text-slate-400">
        {title} <span className="tabular-nums">({events.length})</span>
      </h3>
      {events.length === 0 ? (
        <p className="px-5 pb-4 text-sm text-gray-600 dark:text-slate-400">{empty}</p>
      ) : (
        <ul role="list" aria-labelledby={id} className="divide-y divide-gray-100 dark:divide-slate-700/70">
          {events.map((event) => (
            <li key={event.id}>
              <EventRow event={event} zone={zone} orgQuery={orgQuery} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EventRow({ event, zone, orgQuery }: { event: VenueEvent; zone: string; orgQuery: string }) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, month: 'short', day: 'numeric' }).formatToParts(new Date(event.date));
  const month = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;
  return (
    <Link
      href={`/admin/events/${event.id}${orgQuery}`}
      className={`group flex min-h-16 items-center gap-3 px-5 py-3 hover:bg-gray-50 dark:hover:bg-slate-700/40 ${focusRing} focus-visible:ring-inset focus-visible:ring-offset-0`}
    >
      <span
        aria-hidden
        className="flex h-12 w-11 shrink-0 flex-col items-center justify-center rounded-lg border border-gray-200 bg-gray-50 text-gray-800 dark:border-slate-600 dark:bg-slate-900/60 dark:text-slate-200"
      >
        <span className="text-[0.6rem] font-bold uppercase tracking-wider">{month}</span>
        <span className="text-base font-bold leading-none tabular-nums">{day}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-gray-900 group-hover:text-accent-700 dark:text-white dark:group-hover:text-accent-300">
          {event.name}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-600 dark:text-slate-400">
          <span className="inline-flex items-center gap-1 tabular-nums">
            <CalendarDays className="h-3.5 w-3.5" aria-hidden />
            {formatEventDateTime(event.date, zone)}
          </span>
          {event.admissionMode === 'RSVP' && <span>· RSVP</span>}
        </span>
      </span>
      <EventStatusPill status={event.status} className="hidden shrink-0 sm:inline-flex" />
      <span className="sr-only sm:hidden">, {event.status.toLowerCase()}</span>
      <ArrowUpRight className="h-4 w-4 shrink-0 text-gray-400 group-hover:text-accent-700 dark:text-slate-500 dark:group-hover:text-accent-300" aria-hidden />
    </Link>
  );
}

function RecordCard({ venue }: { venue: AdminVenueDetails }) {
  const { formatDateTime } = useAccountFormat();
  const fmt = (value: string) => formatDateTime(value, { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <OverviewSection id="venue-record" title="Record" delay={180}>
      <Facts
        rows={[
          ['Created', <time key="c" dateTime={venue.createdAt}>{fmt(venue.createdAt)}</time>],
          ['Last updated', <time key="u" dateTime={venue.updatedAt}>{fmt(venue.updatedAt)}</time>],
        ]}
      />
    </OverviewSection>
  );
}

function DangerZone({ venue, onDelete }: { venue: AdminVenueDetails; onDelete: () => void }) {
  const blocked = venue.events.length > 0;
  return (
    <section
      aria-labelledby="venue-danger-title"
      className="rounded-xl border border-red-200 bg-white p-5 motion-safe:animate-card-in dark:border-red-900/50 dark:bg-slate-800"
      style={{ animationDelay: '220ms' }}
    >
      <h2 id="venue-danger-title" className="text-sm font-semibold text-gray-900 dark:text-white">
        Delete venue
      </h2>
      <p id="venue-delete-hint" className="mt-1 text-xs text-gray-600 dark:text-slate-400">
        {blocked
          ? `${venue.events.length} event${venue.events.length === 1 ? ' uses' : 's use'} this venue. Move ${venue.events.length === 1 ? 'it' : 'them'} to another venue before deleting.`
          : 'Removes the venue and its public page. This cannot be undone.'}
      </p>
      <button
        type="button"
        onClick={onDelete}
        aria-disabled={blocked || undefined}
        aria-describedby="venue-delete-hint"
        aria-haspopup="dialog"
        disabled={blocked}
        className={`mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-md border border-red-300 px-3 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/40 sm:min-h-9 ${focusRing}`}
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden />
        Delete venue
      </button>
    </section>
  );
}

function DeleteVenueDialog({ venueName, onConfirm, onClose }: { venueName: string; onConfirm: () => Promise<void>; onClose: () => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const returnTo = useRef<Element | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    returnTo.current = document.activeElement;
    cancelRef.current?.focus();
    return () => (returnTo.current as HTMLElement | null)?.focus?.();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err: any) {
      setError(err?.message || 'Failed to delete the venue');
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-venue-title"
      aria-describedby="delete-venue-body"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl dark:bg-slate-800">
        <h2 id="delete-venue-title" className="text-lg font-semibold text-gray-900 dark:text-white">
          Delete venue
        </h2>
        <p id="delete-venue-body" className="mt-2 text-sm text-gray-600 dark:text-slate-300">
          Delete <strong className="text-gray-900 dark:text-white">{venueName}</strong>? Its public page stops working. This cannot be undone.
        </p>
        {error && (
          <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-200">
            {error}
          </p>
        )}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            ref={cancelRef}
            type="button"
            onClick={onClose}
            disabled={busy}
            className={`min-h-11 rounded-md border border-gray-300 px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700 sm:min-h-10 ${focusRing}`}
          >
            Keep venue
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={busy}
            aria-busy={busy}
            className={`min-h-11 rounded-md bg-red-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-red-500 disabled:opacity-50 sm:min-h-10 ${focusRing}`}
          >
            {busy ? 'Deleting…' : 'Delete venue'}
          </button>
        </div>
      </div>
    </div>
  );
}

function DetailsSkeleton() {
  const bar = 'rounded bg-gray-200 dark:bg-slate-700';
  return (
    <PageFrame>
      <div className="animate-pulse motion-reduce:animate-none" aria-busy="true" aria-label="Loading venue">
        <div className={`${bar} h-4 w-40`} />
        <div className="mt-4 rounded-2xl border border-gray-200 p-6 dark:border-slate-700">
          <div className="flex gap-5">
            <div className={`${bar} h-16 w-16 rounded-xl sm:h-28 sm:w-28`} />
            <div className="flex-1 space-y-3">
              <div className={`${bar} h-4 w-32`} />
              <div className={`${bar} h-8 w-2/3`} />
              <div className={`${bar} h-4 w-1/2`} />
            </div>
          </div>
          <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className={`${bar} h-14`} />
            ))}
          </div>
        </div>
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className={`${bar} h-72 rounded-xl`} />
          <div className={`${bar} h-72 rounded-xl`} />
        </div>
      </div>
    </PageFrame>
  );
}

// useSearchParams() needs a Suspense boundary (Next 14 App Router).
export default function VenueDetailsPage() {
  return (
    <Suspense fallback={<DetailsSkeleton />}>
      <VenueDetailsContent />
    </Suspense>
  );
}
