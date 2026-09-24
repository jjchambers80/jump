'use client';

// Event card for the admin events list (spec 035 D4–D6, D8, D9).
// Cards are <article aria-labelledby> with an <h2> title linking to Edit.
// Layout: left accent bar · date tile · content · actions.

import React from 'react';
import Link from 'next/link';
import {
  formatEventDateTime,
} from '@/lib/eventTime';
import {
  Calendar,
  ChevronDown,
  ChevronRight,
  BarChart3,
  Users,
} from 'lucide-react';
import EventActionsMenu from './EventActionsMenu';
import type { AdmissionMode } from './EventFormLayout';

export interface PriceTier {
  id: string;
  name: string;
  price: number;
  quantityTotal: number;
  quantitySold: number;
  quantityReserved: number;
  quantityAvailable: number;
  displayOrder: number;
  isActive: boolean;
}

export interface EventVenue {
  id: string;
  name: string;
  address: string;
  timezone?: string | null;
}

export interface AdminEvent {
  id: string;
  name: string;
  description?: string;
  date: string;
  capacity: number;
  category?: string;
  status: string;
  venue: EventVenue | null;
  priceTiers: PriceTier[];
  createdAt: string;
  updatedAt: string;
  /** May be missing until 035A lands. */
  admissionMode?: AdmissionMode | null;
  /** May be missing until 035A lands. */
  slug?: string | null;
  /** RSVP "going" count, added by 035A. */
  rsvpGoingCount?: number;
  /** RSVP limit, from event already. */
  rsvpLimit?: number | null;
}

interface EventListCardProps {
  event: AdminEvent;
  selectedOrgId: string | null;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onPublish: () => void;
  onDuplicate: () => void;
  onCancelEvent: () => void;
}

function formatPrice(dollars: number): string {
  return `$${Number(dollars).toFixed(2)}`;
}

const statusAccentColors: Record<string, string> = {
  DRAFT: 'bg-gray-400 dark:bg-slate-500',
  PUBLISHED: 'bg-green-500',
  CANCELLED: 'bg-red-500',
};

const statusPillColors: Record<string, string> = {
  DRAFT:
    'bg-gray-100 text-gray-800 dark:bg-slate-700 dark:text-slate-300',
  PUBLISHED:
    'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  CANCELLED:
    'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
};

export default function EventListCard({
  event,
  selectedOrgId,
  isExpanded,
  onToggleExpand,
  onPublish,
  onDuplicate,
  onCancelEvent,
}: EventListCardProps) {
  const zone = event.venue?.timezone;
  const now = new Date();
  const eventDate = new Date(event.date);
  const isPast = eventDate < now && event.status !== 'CANCELLED';
  const isRsvp = event.admissionMode === 'RSVP';

  const totalSold = event.priceTiers.reduce((s, t) => s + t.quantitySold, 0);
  const totalAvailable = event.priceTiers.reduce((s, t) => s + t.quantityAvailable, 0);
  const totalCapacity = event.priceTiers.reduce((s, t) => s + t.quantityTotal, 0);
  const sellThroughPct =
    totalCapacity > 0 ? Math.round((totalSold / totalCapacity) * 100) : 0;

  // RSVP sell-through
  const rsvpGoing = event.rsvpGoingCount ?? 0;
  const rsvpLimitNum = event.rsvpLimit;
  const hasRsvpLimit = rsvpLimitNum != null && rsvpLimitNum > 0;
  const rsvpPct = hasRsvpLimit ? Math.round((rsvpGoing / rsvpLimitNum!) * 100) : 0;

  const headingId = `event-card-${event.id}-title`;
  const accentColor = statusAccentColors[event.status] || 'bg-gray-400 dark:bg-slate-500';

  // Date tile in the venue's zone
  const dateParts = event.date
    ? new Intl.DateTimeFormat('en-US', {
        timeZone: zone || undefined,
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }).formatToParts(new Date(event.date))
    : [];
  const month = dateParts.find((p) => p.type === 'month')?.value || '';
  const day = dateParts.find((p) => p.type === 'day')?.value || '';
  const year = dateParts.find((p) => p.type === 'year')?.value || '';

  return (
    <article
      aria-labelledby={headingId}
      className={`relative rounded-lg border ${
        isPast && event.status !== 'CANCELLED'
          ? 'border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/60'
          : 'border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800'
      } overflow-hidden`}
    >
      {/* Status accent bar */}
      <div
        className={`absolute left-0 top-0 bottom-0 w-1 ${accentColor} ${
          isPast && event.status !== 'CANCELLED' ? 'opacity-40' : ''
        }`}
        aria-hidden="true"
      />

      {/* Card body grid */}
      <div className="pl-4 sm:pl-5">
        <div className="grid grid-cols-[auto_1fr] xl:grid-cols-[auto_1fr_auto] gap-x-4 gap-y-3 py-4 pr-4 sm:pr-5">
          {/* Date tile */}
          <div
            className={`flex flex-col items-center justify-center w-14 h-16 shrink-0 rounded-lg border ${
              isPast && event.status !== 'CANCELLED'
                ? 'border-gray-200 dark:border-slate-600 bg-gray-100 dark:bg-slate-700/50 text-gray-500 dark:text-slate-400'
                : event.status === 'PUBLISHED'
                ? 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-300'
                : event.status === 'CANCELLED'
                ? 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-300'
                : 'border-gray-200 dark:border-slate-600 bg-gray-50 dark:bg-slate-700/50 text-gray-700 dark:text-slate-300'
            }`}
            aria-hidden="true"
          >
            <span className="text-[10px] font-bold uppercase leading-tight tracking-wider">
              {month}
            </span>
            <span className="text-lg font-bold leading-tight">{day}</span>
            <span className="text-[10px] leading-tight opacity-60">{year}</span>
          </div>

          {/* Content column */}
          <div className="min-w-0 space-y-1.5">
            {/* Title row */}
            <div className="flex flex-wrap items-center gap-2">
              <h2 id={headingId} className="text-base font-semibold text-gray-900 dark:text-white truncate">
                <Link
                  href={`/admin/events/${event.id}/edit?orgId=${selectedOrgId}`}
                  className="hover:text-indigo-600 dark:hover:text-indigo-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
                >
                  {event.name}
                </Link>
              </h2>
              {/* Status pill */}
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                  statusPillColors[event.status] || ''
                }`}
              >
                {event.status}
              </span>
              {/* Ended pill */}
              {isPast && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-200 text-gray-600 dark:bg-slate-600 dark:text-slate-300">
                  Ended
                </span>
              )}
              {/* Category chip */}
              {event.category && (
                <span className="inline-flex items-center gap-1 rounded-md border border-gray-200 dark:border-slate-600 bg-gray-50 dark:bg-slate-700/50 px-2 py-0.5 text-xs font-medium text-gray-600 dark:text-slate-300">
                  {event.category}
                </span>
              )}
              {/* Tier count chip (hidden on RSVP — no tiers; branch on admissionMode, not count) */}
              {!isRsvp && (
                <span className="inline-flex items-center gap-1 rounded-md border border-gray-200 dark:border-slate-600 bg-gray-50 dark:bg-slate-700/50 px-2 py-0.5 text-xs font-medium text-gray-500 dark:text-slate-400 tabular-nums">
                  {event.priceTiers.length} tier{event.priceTiers.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>

            {/* Date line with zone abbreviation */}
            <p className="text-sm text-gray-500 dark:text-slate-400 flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                {formatEventDateTime(event.date, zone)}
              </span>
            </p>

            {/* Venue */}
            {event.venue && (
              <p className="text-sm text-gray-500 dark:text-slate-400 truncate">
                {event.venue.name}
                {event.venue.address ? ` · ${event.venue.address}` : ''}
              </p>
            )}

            {/* Sold / avail + sell-through bar */}
            {!isRsvp && totalCapacity > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm text-gray-600 dark:text-slate-300 tabular-nums">
                  {totalSold} sold / {totalAvailable} avail
                </p>
                <div className="flex items-center gap-2" aria-hidden="true">
                  <div className="w-20 h-1.5 rounded-full bg-gray-200 dark:bg-slate-600">
                    <div
                      className={`h-1.5 rounded-full ${
                        sellThroughPct >= 100
                          ? 'bg-red-500'
                          : sellThroughPct >= 80
                          ? 'bg-yellow-500'
                          : 'bg-indigo-500'
                      }`}
                      style={{ width: `${Math.min(sellThroughPct, 100)}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-500 dark:text-slate-400 tabular-nums">
                    Cap {totalCapacity} ({sellThroughPct}%)
                  </span>
                </div>
              </div>
            )}
            {!isRsvp && totalCapacity === 0 && (
              <p className="text-sm text-gray-500 dark:text-slate-400 tabular-nums">
                {totalSold} sold / {totalAvailable} avail · No tiers yet
              </p>
            )}
            {isRsvp && (
              <p className="text-sm text-gray-500 dark:text-slate-400 tabular-nums">
                {rsvpGoing} going
                {hasRsvpLimit ? ` / ${rsvpLimitNum} limit` : ''}
                {hasRsvpLimit && (
                  <span className="ml-2 text-xs text-gray-400 dark:text-slate-500" aria-hidden="true">
                    ({rsvpPct}%)
                  </span>
                )}
              </p>
            )}
          </div>

          {/* Actions column */}
          <div className="flex items-start gap-2 xl:col-span-1 col-span-2 xl:col-start-auto">
            <div className="flex flex-wrap items-center gap-2">
              {/* Primary actions */}
              {event.status !== 'CANCELLED' && (
                <Link
                  href={`/admin/events/${event.id}/edit?orgId=${selectedOrgId}`}
                  className="inline-flex min-h-9 items-center rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  Edit
                </Link>
              )}
              {event.status === 'CANCELLED' && (
                <button
                  type="button"
                  onClick={onDuplicate}
                  className="inline-flex min-h-9 items-center rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  Duplicate
                </button>
              )}
              {/* Publish secondary for DRAFT */}
              {event.status === 'DRAFT' && (
                <button
                  type="button"
                  onClick={onPublish}
                  className="inline-flex min-h-9 items-center rounded-md bg-green-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-green-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
                >
                  Publish
                </button>
              )}
              {/* Contextual: Analytics (TICKETED, published) or RSVPs */}
              {isRsvp && (
                <Link
                  href={`/admin/events/${event.id}/rsvps?orgId=${selectedOrgId}`}
                  className="inline-flex min-h-9 items-center gap-1 rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  <Users className="h-3.5 w-3.5" aria-hidden="true" />
                  RSVPs
                </Link>
              )}
              {!isRsvp && event.status === 'PUBLISHED' && (
                <Link
                  href={`/admin/events/${event.id}/analytics`}
                  className="inline-flex min-h-9 items-center gap-1 rounded-md border border-indigo-300 dark:border-indigo-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  <BarChart3 className="h-3.5 w-3.5" aria-hidden="true" />
                  Analytics
                </Link>
              )}
              {/* Tier disclosure */}
              {event.priceTiers.length > 0 && (
                <button
                  type="button"
                  onClick={onToggleExpand}
                  aria-expanded={isExpanded}
                  aria-controls={`event-tiers-${event.id}`}
                  className="inline-flex min-h-9 items-center gap-1 rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  {isExpanded ? (
                    <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  {isExpanded ? 'Hide Tiers' : 'Tiers'}
                </button>
              )}
              {/* ⋯ menu */}
              <EventActionsMenu
                eventId={event.id}
                eventName={event.name}
                slug={event.slug}
                selectedOrgId={selectedOrgId}
                onDuplicate={onDuplicate}
                onCancelEvent={onCancelEvent}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Expanded Tier table */}
      {isExpanded && (
        <div
          id={`event-tiers-${event.id}`}
          role="region"
          className="border-t border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900/50 px-4 sm:px-5 py-3"
        >
          {event.priceTiers.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-slate-400">No price tiers</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Price tiers for {event.name}</caption>
                <thead>
                  <tr className="text-left text-xs text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                    <th className="pb-2 pr-3">Tier</th>
                    <th className="pb-2 pr-3">Price</th>
                    <th className="pb-2 pr-3">Total</th>
                    <th className="pb-2 pr-3">Sold</th>
                    <th className="pb-2 pr-3">Reserved</th>
                    <th className="pb-2 pr-3">Available</th>
                    <th className="pb-2 pr-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                  {[...event.priceTiers]
                    .sort((a, b) => a.displayOrder - b.displayOrder)
                    .map((tier) => {
                      const pct =
                        tier.quantityTotal > 0
                          ? Math.round((tier.quantitySold / tier.quantityTotal) * 100)
                          : 0;
                      return (
                        <tr key={tier.id} className="text-gray-900 dark:text-slate-100">
                          <td className="py-2 pr-3 font-medium whitespace-nowrap">{tier.name}</td>
                          <td className="py-2 pr-3 tabular-nums">{formatPrice(tier.price)}</td>
                          <td className="py-2 pr-3 tabular-nums">{tier.quantityTotal}</td>
                          <td className="py-2 pr-3 tabular-nums">{tier.quantitySold}</td>
                          <td className="py-2 pr-3 tabular-nums">{tier.quantityReserved}</td>
                          <td className="py-2 pr-3 tabular-nums">
                            <span
                              className={
                                tier.quantityAvailable === 0
                                  ? 'text-red-600 dark:text-red-400 font-semibold'
                                  : ''
                              }
                            >
                              {tier.quantityAvailable}
                            </span>
                          </td>
                          <td className="py-2">
                            <div className="flex items-center gap-2">
                              <div className="w-16 bg-gray-200 dark:bg-slate-700 rounded-full h-1.5">
                                <div
                                  className="bg-indigo-600 h-1.5 rounded-full"
                                  style={{ width: `${Math.min(pct, 100)}%` }}
                                />
                              </div>
                              <span className="text-xs text-gray-500 dark:text-slate-400 tabular-nums">
                                {pct}%
                              </span>
                              {!tier.isActive && (
                                <span className="text-xs text-yellow-600 dark:text-yellow-400">
                                  Inactive
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </article>
  );
}