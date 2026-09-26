'use client';

// RSVP card on the public event page (spec 034), drawn as an admission pass:
// a brand-colored stub (date + availability) torn from the form by a
// perforation. The notches are cut with a CSS mask (`.rsvp-pass` in
// globals.css), so the pass reads correctly on any page or card background.
// After a successful RSVP the same pass is "stamped" rather than replaced.

import React, { useState } from 'react';
import Link from 'next/link';
import { CalendarPlus, Check, Minus, Plus } from 'lucide-react';
import { rsvpApi } from '../../../services/api';
import { formatEventDate, formatEventTime } from '@/lib/eventTime';
import { acceptancesFor, LEGAL_PAGES_ENABLED, LEGAL_PATHS, type LegalVersions } from '@/lib/legal';

export interface RsvpPassEvent {
  id: string;
  name: string;
  date: string;
  rsvpLimit?: number | null;
  rsvpMaxPartySize?: number;
  rsvpRemaining?: number | null;
  organizationName?: string | null;
  venue: { name: string; address: string; timezone?: string } | null;
}

interface RsvpPassProps {
  event: RsvpPassEvent;
  isPastEvent: boolean;
  legalVersions: LegalVersions | null;
  onLegalStale: () => void;
  onSubmitted: () => void;
}

const inputClass =
  'block h-11 w-full rounded-lg border border-gray-300 bg-white px-3.5 text-[15px] text-gray-900 placeholder:text-gray-400 shadow-sm shadow-gray-900/[0.02] transition-colors focus:border-brand-link focus:outline-none focus:ring-1 focus:ring-brand-link dark:border-slate-600 dark:bg-slate-900/60 dark:text-slate-100 dark:placeholder:text-slate-500';

const labelClass = 'mb-1.5 block text-[13px] font-medium text-gray-700 dark:text-slate-300';

/** "Sat, Dec 26, 2026" → tile parts, in the venue's zone (spec 033). */
function dateTile(date: string, zone?: string) {
  const match = formatEventDate(date, zone, { weekday: 'short', month: 'short' }).match(/^(\w+), (\w+) (\d+), (\d+)$/);
  return match ? { weekday: match[1], month: match[2], day: match[3] } : null;
}

/** Scarcity only once it means something: ≤ 10 spots or the last 20 %. */
function scarcity(limit?: number | null, remaining?: number | null) {
  if (limit == null || remaining == null || limit <= 0) return null;
  if (remaining > Math.max(10, Math.ceil(limit * 0.2))) return null;
  return { remaining, taken: Math.min(1, Math.max(0, (limit - remaining) / limit)) };
}

/** A minimal .ics so the RSVP lands in the buyer's calendar. No end time is known. */
function downloadIcs(event: RsvpPassEvent) {
  const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const escape = (s: string) => s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
  const location = event.venue ? `${event.venue.name}, ${event.venue.address}` : '';
  const body = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Jump//RSVP//EN',
    'BEGIN:VEVENT',
    `UID:${event.id}@jump`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(new Date(event.date))}`,
    `SUMMARY:${escape(event.name)}`,
    location && `LOCATION:${escape(location)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ]
    .filter(Boolean)
    .join('\r\n');
  const url = URL.createObjectURL(new Blob([body], { type: 'text/calendar' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${event.name.replace(/[^\w-]+/g, '-').toLowerCase()}.ics`;
  link.click();
  URL.revokeObjectURL(url);
}

export default function RsvpPass({ event, isPastEvent, legalVersions, onLegalStale, onSubmitted }: RsvpPassProps) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [partySize, setPartySize] = useState(1);
  const [marketing, setMarketing] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const zone = event.venue?.timezone;
  const tile = dateTile(event.date, zone);
  const time = formatEventTime(event.date, zone);
  const organizer = event.organizationName || 'the organizer';
  const full = !isPastEvent && event.rsvpRemaining != null && event.rsvpRemaining <= 0;
  const low = full ? null : scarcity(event.rsvpLimit, event.rsvpRemaining);
  // Never offer a party the event can no longer seat; the backend enforces it too.
  const maxParty = Math.max(1, Math.min(event.rsvpMaxPartySize ?? 1, event.rsvpRemaining ?? Infinity));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!legalVersions) return;
    try {
      setSubmitting(true);
      setError(null);
      await rsvpApi.create(event.id, {
        firstName,
        lastName,
        email,
        partySize: (event.rsvpMaxPartySize ?? 1) > 1 ? partySize : undefined,
        marketing,
        acceptances: acceptancesFor(legalVersions),
      });
      setSubmitted(true);
      onSubmitted();
    } catch (err: any) {
      if (err?.code === 'RSVP_FULL') {
        setError('RSVPs are full for this event.');
      } else if (err?.code === 'LEGAL_VERSION_STALE') {
        setError('The terms have been updated. Please refresh and try again.');
        onLegalStale();
      } else {
        setError(err?.message || 'Failed to submit RSVP. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const stubLabel = isPastEvent ? 'Event ended' : full ? 'RSVPs are full' : submitted ? 'Confirmed' : 'Free admission';
  const stubNote = isPastEvent
    ? 'RSVPs are closed'
    : full
      ? 'Every spot is reserved'
      : submitted
        ? `Admit ${partySize}`
        : low
          ? `Only ${low.remaining} ${low.remaining === 1 ? 'spot' : 'spots'} left`
          : 'RSVP required';
  const muted = isPastEvent || full;

  return (
    <div className="drop-shadow-[0_10px_24px_rgba(15,23,42,0.10)] dark:drop-shadow-[0_12px_28px_rgba(0,0,0,0.45)]">
      <section
        aria-labelledby="rsvp-heading"
        className="rsvp-pass relative overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-800"
      >
        {/* Stub — fixed height: the mask's notches sit exactly on its lower edge */}
        <div
          className={`flex h-28 items-center justify-between gap-4 px-6 ${
            muted ? 'bg-gray-100 text-gray-700 dark:bg-slate-700/60 dark:text-slate-200' : 'bg-brand text-brand-fg'
          }`}
        >
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] opacity-75">RSVP</p>
            <h2 id="rsvp-heading" className="mt-0.5 text-2xl font-bold leading-tight tracking-tight">
              {stubLabel}
            </h2>
            <p className="mt-0.5 text-sm font-medium opacity-85" data-testid="rsvp-availability">
              {stubNote}
            </p>
          </div>
          {tile && (
            <div
              className={`flex w-[4.25rem] shrink-0 flex-col items-center rounded-xl py-1.5 ring-1 ring-inset ${
                muted ? 'ring-gray-300 dark:ring-slate-500' : 'bg-black/10 ring-black/10'
              }`}
              aria-hidden
            >
              <span className="text-[10px] font-bold uppercase tracking-[0.16em] opacity-80">{tile.month}</span>
              <span className="text-[26px] font-extrabold leading-none tabular-nums">{tile.day}</span>
              <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] opacity-70">{tile.weekday}</span>
            </div>
          )}
        </div>

        {/* Perforation between the notches */}
        <div aria-hidden className="mx-5 border-t-2 border-dashed border-gray-300 dark:border-slate-600" />

        <div className="px-6 pb-6 pt-5">
          {isPastEvent ? (
            <p className="text-sm leading-relaxed text-gray-600 dark:text-slate-400">
              This event took place on {formatEventDate(event.date, zone, { weekday: 'long', month: 'long' })}. RSVPs are no
              longer being accepted.
            </p>
          ) : full ? (
            <p className="text-sm leading-relaxed text-gray-600 dark:text-slate-400">
              All spots for this event have been reserved. Check back with {organizer} in case spots open up.
            </p>
          ) : submitted ? (
            <div className="text-center" role="status">
              <div className="mx-auto mb-4 flex h-20 w-20 -rotate-6 items-center justify-center rounded-full border-[3px] border-double border-brand-link text-brand-link motion-safe:animate-stamp-in">
                <div className="flex flex-col items-center leading-none">
                  <Check className="h-6 w-6" strokeWidth={3} aria-hidden />
                  <span className="mt-1 text-[10px] font-extrabold uppercase tracking-[0.2em]">In</span>
                </div>
              </div>
              <h3 className="text-xl font-bold tracking-tight text-gray-900 dark:text-slate-100">You&apos;re on the list</h3>
              <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
                {firstName} {lastName}
                {partySize > 1 && <> + {partySize - 1} {partySize === 2 ? 'guest' : 'guests'}</>}
              </p>
              <p className="mt-3 text-sm text-gray-600 dark:text-slate-400">
                We sent a confirmation to <span className="font-medium text-gray-900 dark:text-slate-200">{email}</span>.
              </p>
              <button
                type="button"
                onClick={() => downloadIcs(event)}
                className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white text-sm font-semibold text-gray-800 transition-colors hover:border-brand-link hover:text-brand-link dark:border-slate-600 dark:bg-transparent dark:text-slate-100"
              >
                <CalendarPlus className="h-4 w-4" aria-hidden />
                Add to calendar
              </button>
              <p className="mt-4 text-xs text-gray-500 dark:text-slate-500">
                Plans change? Cancel any time from the link in your confirmation email.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4" id="rsvp-form">
              {low && low.taken > 0 && (
                <div aria-hidden className="-mt-1 mb-1">
                  <div className="h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-slate-700">
                    <div className="h-full rounded-full bg-brand" style={{ width: `${Math.round(low.taken * 100)}%` }} />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="rsvp-first-name" className={labelClass}>
                    First name
                  </label>
                  <input
                    id="rsvp-first-name"
                    type="text"
                    autoComplete="given-name"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    required
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor="rsvp-last-name" className={labelClass}>
                    Last name
                  </label>
                  <input
                    id="rsvp-last-name"
                    type="text"
                    autoComplete="family-name"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    required
                    className={inputClass}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="rsvp-email" className={labelClass}>
                  Email
                </label>
                <input
                  id="rsvp-email"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className={inputClass}
                  placeholder="you@example.com"
                />
              </div>

              {maxParty > 1 && (
                <div className="flex items-center justify-between gap-4 rounded-lg border border-gray-200 px-3.5 py-2.5 dark:border-slate-700">
                  <div>
                    <p id="rsvp-party-label" className="text-sm font-medium text-gray-900 dark:text-slate-100">
                      Party size
                    </p>
                    <p className="text-xs text-gray-500 dark:text-slate-400">Including you</p>
                  </div>
                  <div className="flex items-center gap-3" role="group" aria-labelledby="rsvp-party-label">
                    <button
                      type="button"
                      aria-label="Fewer guests"
                      onClick={() => setPartySize((n) => Math.max(1, n - 1))}
                      disabled={partySize <= 1}
                      className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-300 text-gray-700 transition-colors hover:border-gray-400 disabled:opacity-30 dark:border-slate-600 dark:text-slate-200"
                    >
                      <Minus className="h-4 w-4" aria-hidden />
                    </button>
                    <output
                      id="rsvp-party-size"
                      aria-live="polite"
                      className="min-w-[1.5rem] text-center text-lg font-semibold tabular-nums text-gray-900 dark:text-slate-100"
                    >
                      {partySize}
                    </output>
                    <button
                      type="button"
                      aria-label="More guests"
                      onClick={() => setPartySize((n) => Math.min(maxParty, n + 1))}
                      disabled={partySize >= maxParty}
                      className="flex h-9 w-9 items-center justify-center rounded-full bg-brand text-brand-fg transition-opacity hover:opacity-90 disabled:opacity-30"
                    >
                      <Plus className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                </div>
              )}

              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={marketing}
                  onChange={(e) => setMarketing(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 accent-[var(--brand)] dark:border-slate-600"
                />
                <span className="text-sm text-gray-600 dark:text-slate-400">Email me news and updates from {organizer}</span>
              </label>

              {error && (
                <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20">
                  <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={submitting || !legalVersions}
                className="flex h-12 w-full items-center justify-center rounded-lg bg-brand text-base font-bold text-brand-fg transition-colors hover:bg-brand-hover disabled:opacity-50"
              >
                {submitting ? 'Reserving…' : partySize > 1 ? `Reserve ${partySize} spots` : 'Reserve my spot'}
              </button>

              {/* Legal consent (spec 034 D13) */}
              <p className="text-center text-[11px] leading-relaxed text-gray-500 dark:text-slate-500">
                By RSVPing, you agree to{' '}
                {LEGAL_PAGES_ENABLED ? (
                  <>
                    <Link href={LEGAL_PATHS.terms} target="_blank" className="underline hover:text-gray-700 dark:hover:text-slate-300">
                      Terms of Service
                    </Link>
                    {' and '}
                    <Link href={LEGAL_PATHS.privacy} target="_blank" className="underline hover:text-gray-700 dark:hover:text-slate-300">
                      Privacy Policy
                    </Link>
                  </>
                ) : (
                  'the Terms of Service and Privacy Policy'
                )}
                . I agree to {organizer} and Jump collecting and storing this information as described.
              </p>
            </form>
          )}
        </div>

        {!submitted && !muted && (
          <p className="border-t border-gray-100 px-6 py-3 text-center text-xs text-gray-500 dark:border-slate-700/70 dark:text-slate-400">
            Starts {time} · {event.venue?.name ?? 'Venue TBA'}
          </p>
        )}
      </section>
    </div>
  );
}
