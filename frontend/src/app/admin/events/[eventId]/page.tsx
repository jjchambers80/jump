'use client';

// Event Details — the event's read-only home in the admin (spec 037 phase 1).
// The events list card opens here. Every section shows what is set and links
// to the one place it is edited; this page never writes except Publish,
// Duplicate and Cancel, which are the same actions as on the list card.
// Numbers come from one request: GET /organizations/:orgId/events/:id/overview.

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { ChevronRight, ExternalLink, MapPin, Pencil, CalendarDays } from 'lucide-react';
import api from '@/services/api';
import { useOrg } from '@/components/OrgContext';
import { imageVariantUrl } from '@/lib/assets';
import { formatEventDate, formatEventDateTime, formatEventTime } from '@/lib/eventTime';
import { EventStatusPill, Perforation } from '@/components/events/EventEditSummary';
import EventActionsMenu from '@/components/events/EventActionsMenu';
import CancelEventDialog from '@/components/events/CancelEventDialog';
import DuplicateEventDialog from '../DuplicateEventDialog';
import { WorkspaceTabs, workspaceTabs } from '@/components/events/EventWorkspace';
import {
  AdmissionCard,
  ApplicationsSection,
  DescriptionSection,
  ListingCard,
  MapCard,
  PaymentsCard,
  RsvpSection,
  SalesSection,
  WhenWhereCard,
} from '@/components/events/EventOverviewSections';
import { formatCount as n, formatMoney, relativeDays, type EventOverview, type OverviewForm, type OverviewTier } from '@/lib/eventOverview';
import { AdmissionFlyout, FormSettingsFlyout, ListingFlyout, TierFlyout } from '@/components/events/EventFlyouts';

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-900';

function EventDetailsContent() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const eventId = params.eventId as string;
  const { selectedOrgId, loading: orgLoading } = useOrg();
  const orgId = selectedOrgId || searchParams.get('orgId');

  const [overview, setOverview] = useState<EventOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [flyout, setFlyout] = useState<
    | { kind: 'admission' }
    | { kind: 'listing' }
    | { kind: 'tier'; tier: OverviewTier | null }
    | { kind: 'form'; form: OverviewForm }
    | null
  >(null);

  const load = useCallback(async () => {
    if (orgLoading || !orgId || !eventId) return;
    try {
      setError(null);
      const data = await api.get<EventOverview>(`/organizations/${orgId}/events/${eventId}/overview`);
      setOverview(data);
    } catch (err: any) {
      setOverview(null);
      setError(err?.status === 404 ? 'This event is not in the selected organization.' : err?.message || 'Failed to load the event');
    } finally {
      setLoading(false);
    }
  }, [orgLoading, orgId, eventId]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  const publish = async () => {
    if (!orgId) return;
    setPublishing(true);
    setError(null);
    try {
      await api.post(`/organizations/${orgId}/events/${eventId}/publish`, {});
      setNotice('Published. The event page is live.');
      await load();
    } catch (err: any) {
      setError(err?.message || 'Failed to publish the event');
    } finally {
      setPublishing(false);
    }
  };

  const cancelEvent = async () => {
    if (!orgId) return;
    setCancelBusy(true);
    try {
      await api.post(`/organizations/${orgId}/events/${eventId}/cancel`, {});
      setCancelling(false);
      setNotice('Event cancelled.');
      await load();
    } catch (err: any) {
      setError(err?.message || 'Failed to cancel the event');
    } finally {
      setCancelBusy(false);
    }
  };

  if (orgLoading) return <DetailsSkeleton />;

  if (!orgId) {
    return (
      <PageFrame>
        <p className="text-sm text-gray-600 dark:text-slate-400">Choose an organization to see this event.</p>
      </PageFrame>
    );
  }

  if (loading) return <DetailsSkeleton />;

  if (!overview) {
    return (
      <PageFrame>
        <Breadcrumb />
        <div role="alert" className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
          {error || 'Event not found'}
        </div>
      </PageFrame>
    );
  }

  const { event } = overview;
  const q = `?orgId=${encodeURIComponent(orgId)}`;
  const base = `/admin/events/${eventId}`;
  // Spec 037 phase 3: two section editors; small edits open a flyout here.
  const edit = (section: string) =>
    `${base}/edit/${['event-price-tiers', 'event-add-ons', 'event-admission'].includes(section) ? 'sales' : 'details'}${q}#${section}`;
  const hasSales = (overview.tickets?.issued ?? 0) > 0 || overview.money.tickets.orders > 0 || (overview.rsvp?.going ?? 0) > 0;
  const reload = () => {
    setFlyout(null);
    setNotice('Saved.');
    load();
  };
  const publicPath = `/events/${encodeURIComponent(event.slug || event.id)}`;
  const ticketed = event.admissionMode === 'TICKETED';

  return (
    <PageFrame>
      <Breadcrumb name={event.name} />

      <EventHero
        overview={overview}
        publicPath={publicPath}
        actions={
          <>
            <a
              href={publicPath}
              target="_blank"
              rel="noreferrer"
              className={`inline-flex min-h-9 items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 text-sm font-semibold text-gray-800 hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700 ${focusRing}`}
            >
              View page
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
            {event.status === 'DRAFT' && (
              <button
                type="button"
                onClick={publish}
                disabled={publishing}
                className={`inline-flex min-h-9 items-center rounded-md bg-emerald-600 px-3 text-sm font-semibold text-white shadow-sm hover:bg-emerald-500 disabled:opacity-60 ${focusRing}`}
              >
                {publishing ? 'Publishing…' : 'Publish'}
              </button>
            )}
            {event.status !== 'CANCELLED' && (
              <Link
                href={`${base}/edit/details${q}`}
                className={`inline-flex min-h-9 items-center gap-1.5 rounded-md bg-accent-500 px-3 text-sm font-semibold text-gray-950 shadow-sm hover:bg-accent-hover ${focusRing}`}
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden />
                Edit event
              </Link>
            )}
            <EventActionsMenu
              eventId={event.id}
              eventName={event.name}
              slug={event.slug}
              selectedOrgId={orgId}
              onDuplicate={() => setDuplicating(true)}
              onCancelEvent={() => setCancelling(true)}
            />
          </>
        }
      />

      <div className="mt-5">
        <WorkspaceTabs
          current="overview"
          tabs={workspaceTabs(
            eventId,
            {
              admissionMode: event.admissionMode,
              formCount: overview.applications.forms.length,
              toReview: overview.applications.forms.reduce((s, f) => s + f.counts.SUBMITTED, 0),
            },
            orgId
          )}
        />
      </div>

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
          {ticketed ? (
            <SalesSection
              overview={overview}
              editHref={edit('event-price-tiers')}
              ordersHref={`/admin/orders?eventId=${eventId}`}
              onEditTier={event.status === 'CANCELLED' ? undefined : (tier) => setFlyout({ kind: 'tier', tier })}
              delay={40}
            />
          ) : (
            <RsvpSection overview={overview} editHref={edit('event-admission')} rsvpsHref={`${base}/rsvps`} delay={40} />
          )}
          <ApplicationsSection overview={overview} base={`${base}/applications`} onFormSettings={(form) => setFlyout({ kind: 'form', form })} delay={80} />
          <DescriptionSection overview={overview} editHref={edit('event-details')} delay={120} />
        </div>
        <aside className="min-w-0 space-y-6" aria-label="Event settings">
          <WhenWhereCard overview={overview} editHref={edit('event-when-where')} delay={60} />
          <AdmissionCard overview={overview} editHref={edit('event-admission')} onEdit={() => setFlyout({ kind: 'admission' })} delay={100} />
          <MapCard overview={overview} delay={140} />
          <ListingCard overview={overview} editHref={edit('event-listing')} onEdit={() => setFlyout({ kind: 'listing' })} publicHref={publicPath} delay={180} />
          <PaymentsCard overview={overview} delay={220} />
        </aside>
      </div>

      {flyout?.kind === 'admission' && (
        <AdmissionFlyout orgId={orgId} event={event} hasSales={hasSales} onClose={() => setFlyout(null)} onSaved={reload} />
      )}
      {flyout?.kind === 'listing' && <ListingFlyout orgId={orgId} event={event} onClose={() => setFlyout(null)} onSaved={reload} />}
      {flyout?.kind === 'tier' && (
        <TierFlyout orgId={orgId} event={event} tier={flyout.tier} onClose={() => setFlyout(null)} onSaved={reload} />
      )}
      {flyout?.kind === 'form' && (
        <FormSettingsFlyout event={event} form={flyout.form} onClose={() => setFlyout(null)} onSaved={reload} />
      )}

      {duplicating && (
        <DuplicateEventDialog
          orgId={orgId}
          event={{ id: event.id, name: event.name, venue: event.venue }}
          onClose={() => setDuplicating(false)}
          onDone={(created) => {
            setDuplicating(false);
            router.push(`/admin/events/${created.id}${q}`);
          }}
        />
      )}
      {cancelling && (
        <CancelEventDialog eventName={event.name} busy={cancelBusy} onConfirm={cancelEvent} onClose={() => setCancelling(false)} />
      )}
    </PageFrame>
  );
}

function PageFrame({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-screen-2xl px-4 py-6 sm:px-6 sm:py-8">{children}</div>;
}

function Breadcrumb({ name }: { name?: string }) {
  return (
    <nav aria-label="Breadcrumb" className="text-sm">
      <ol className="flex min-w-0 items-center gap-1 text-gray-500 dark:text-slate-400">
        <li>
          <Link href="/admin/events" className={`rounded font-medium hover:text-gray-900 dark:hover:text-white ${focusRing}`}>
            Events
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

/**
 * The event as a ticket stub: image and identity above the tear line, the
 * four numbers that say how it is going below it.
 */
function EventHero({
  overview,
  publicPath,
  actions,
}: {
  overview: EventOverview;
  publicPath: string;
  actions: React.ReactNode;
}) {
  const { event, money, tickets, rsvp, applications } = overview;
  const zone = event.venue?.timezone;
  const image = imageVariantUrl(event.logoUrl, 'thumb');
  const monogram = (event.name.trim()[0] ?? 'E').toUpperCase();
  const past = new Date(event.date) < new Date();
  const ticketed = event.admissionMode === 'TICKETED';
  const dateParts = formatEventDate(event.date, zone).match(/^(\w+), (\w+) (\d+), (\d+)$/);

  const allocated = event.priceTiers.reduce((s, t) => s + t.quantityTotal, 0);
  const sold = event.priceTiers.reduce((s, t) => s + t.quantitySold, 0);
  const forms = applications.forms;
  const appsTotal = forms.reduce((s, f) => s + f.total, 0);
  const toReview = forms.reduce((s, f) => s + f.counts.SUBMITTED, 0);

  const stats: { label: string; value: string; detail?: string }[] = ticketed
    ? [
        { label: 'Collected', value: formatMoney(money.gross), detail: money.refunded > 0 ? `${formatMoney(money.refunded)} refunded` : `${n(money.tickets.orders + money.applications.orders)} paid orders` },
        { label: 'Tickets sold', value: n(sold), detail: allocated ? `of ${n(allocated)} · ${Math.round((sold / allocated) * 100)}%` : 'No tiers yet' },
        { label: 'Checked in', value: n(tickets?.checkedIn ?? 0), detail: `of ${n(tickets?.issued ?? 0)} issued` },
        { label: 'Applications', value: n(appsTotal), detail: forms.length ? (toReview ? `${n(toReview)} to review` : 'None waiting') : 'No forms' },
      ]
    : [
        { label: 'Guests', value: n(rsvp?.headcount ?? 0), detail: event.rsvpLimit ? `of ${n(event.rsvpLimit)}` : 'No limit' },
        { label: 'RSVPs', value: n(rsvp?.going ?? 0), detail: `${n(rsvp?.cancelled ?? 0)} cancelled` },
        { label: 'Spots left', value: rsvp?.remaining == null ? '∞' : n(rsvp.remaining), detail: 'Free admission' },
        { label: 'Applications', value: n(appsTotal), detail: forms.length ? (toReview ? `${n(toReview)} to review` : 'None waiting') : 'No forms' },
      ];

  return (
    <section
      aria-labelledby="event-title"
      className="relative mt-4 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm shadow-gray-900/[0.04] motion-safe:animate-card-in dark:border-slate-700/80 dark:bg-slate-800 dark:shadow-none"
    >
      {/* A wash of the event image behind the identity row; hatch when there is none. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-40 overflow-hidden">
        {image ? (
          <img src={image} alt="" className="h-full w-full scale-125 object-cover opacity-[0.14] blur-2xl dark:opacity-20" />
        ) : (
          <div className="h-full w-full [background-image:repeating-linear-gradient(135deg,rgb(99_102_241/0.06)_0_1px,transparent_1px_10px)]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-white dark:to-slate-800" />
      </div>

      <div className="relative flex flex-col gap-5 p-5 sm:p-6 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 gap-4 sm:gap-5">
          {/* Date tile over the image tile, like the list card, only larger. */}
          <div className="relative shrink-0">
            <div className="h-16 w-16 overflow-hidden rounded-xl bg-accent-50 ring-1 ring-inset ring-black/5 dark:bg-slate-700/60 dark:ring-white/10 sm:h-28 sm:w-28">
              {image ? (
                <img src={image} alt="" className={`h-full w-full object-cover ${event.status === 'CANCELLED' ? 'grayscale' : ''}`} />
              ) : (
                <div className="flex h-full w-full items-center justify-center [background-image:repeating-linear-gradient(135deg,rgb(99_102_241/0.10)_0_1px,transparent_1px_7px)]">
                  <span className="select-none text-3xl font-black tracking-tighter sm:text-5xl text-accent-400/60 dark:text-accent-300/40">{monogram}</span>
                </div>
              )}
            </div>
            {dateParts && (
              <div
                aria-hidden
                className="absolute -bottom-2 -right-2 flex w-10 flex-col sm:-bottom-3 sm:-right-3 sm:w-12 items-center overflow-hidden rounded-lg border border-gray-200 bg-white text-center shadow-md dark:border-slate-600 dark:bg-slate-900"
              >
                <span className="w-full bg-accent-500 py-px text-[0.6rem] font-bold uppercase tracking-[0.16em] text-gray-950">{dateParts[2]}</span>
                <span className="py-0.5 text-lg font-bold leading-none tabular-nums text-gray-900 dark:text-white">{dateParts[3]}</span>
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <EventStatusPill status={event.status} />
              {event.status !== 'CANCELLED' && (
                <span className="text-xs font-medium text-gray-500 dark:text-slate-400">{past ? 'Ended' : 'Starts'} {relativeDays(event.date)}</span>
              )}
              <span className="text-xs text-gray-400 dark:text-slate-500">·</span>
              <span className="text-xs font-medium text-gray-500 dark:text-slate-400">{ticketed ? 'Ticketed' : 'RSVP'}</span>
            </div>
            <h1 id="event-title" className="mt-1.5 text-2xl font-bold tracking-tight text-gray-900 [overflow-wrap:anywhere] dark:text-white sm:text-3xl">
              {event.name}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-600 dark:text-slate-300">
              <span className="inline-flex items-center gap-1.5 tabular-nums">
                <CalendarDays className="h-4 w-4 text-gray-400 dark:text-slate-500" aria-hidden />
                {formatEventDateTime(event.date, zone)}
              </span>
              {event.venue && (
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <MapPin className="h-4 w-4 shrink-0 text-gray-400 dark:text-slate-500" aria-hidden />
                  <span className="truncate">{event.venue.name}</span>
                </span>
              )}
            </div>
            <p className="mt-1 truncate font-mono text-xs text-gray-400 dark:text-slate-500">
              {publicPath}
              <span className="sr-only">, doors at {formatEventTime(event.date, zone)}</span>
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:justify-end">{actions}</div>
      </div>

      <Perforation />

      <dl className="relative grid grid-cols-2 lg:grid-cols-4">
        {stats.map((s, i) => (
          <div
            key={s.label}
            className={`px-5 py-4 sm:px-6 ${i % 2 === 1 ? 'border-l border-gray-100 dark:border-slate-700/70' : ''} ${
              i >= 2 ? 'border-t border-gray-100 dark:border-slate-700/70 lg:border-t-0' : ''
            } ${i === 2 ? 'lg:border-l' : ''}`}
          >
            <dt className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-gray-500 dark:text-slate-400">{s.label}</dt>
            <dd className="mt-1">
              <span className="block text-2xl font-semibold tabular-nums tracking-tight text-gray-900 dark:text-white">{s.value}</span>
              {s.detail && <span className="block text-xs tabular-nums text-gray-500 dark:text-slate-400">{s.detail}</span>}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function DetailsSkeleton() {
  const bar = 'rounded bg-gray-200 dark:bg-slate-700';
  return (
    <PageFrame>
      <div className="animate-pulse motion-reduce:animate-none" aria-busy="true" aria-label="Loading event">
        <div className={`${bar} h-4 w-40`} />
        <div className="mt-4 rounded-2xl border border-gray-200 p-6 dark:border-slate-700">
          <div className="flex gap-5">
            <div className={`${bar} h-28 w-28 rounded-xl`} />
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
export default function EventDetailsPage() {
  return (
    <Suspense fallback={<DetailsSkeleton />}>
      <EventDetailsContent />
    </Suspense>
  );
}
