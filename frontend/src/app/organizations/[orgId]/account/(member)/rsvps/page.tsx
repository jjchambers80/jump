// RSVPs (spec 040 PA-05): free-admission events the buyer said they're going
// to, upcoming first, with the same cancel as the emailed link. Dates are the
// venue's wall clock (spec 033).
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CalendarCheck, MapPin, Users } from 'lucide-react';
import { dateTile } from '@/lib/dateTile';
import { formatEventTime } from '@/lib/eventTime';
import { useAccount, type AccountRsvp } from '@/components/account/AccountContext';
import { isUpcoming } from '@/components/account/TicketStubs';

function RsvpStub({ rsvp, past, onCancel, busy }: { rsvp: AccountRsvp; past: boolean; onCancel: () => void; busy: boolean }) {
  const tile = dateTile(rsvp.event.date, rsvp.event.timezone);
  const going = rsvp.status === 'GOING';
  const faded = past || !going;
  const href = `/events/${encodeURIComponent(rsvp.event.slug || rsvp.event.id)}`;
  return (
    <li className="event-stub-shadow" data-testid="account-rsvp">
      <div className="event-stub flex min-h-[7rem] overflow-hidden rounded-2xl bg-white ring-1 ring-inset ring-gray-200 dark:bg-slate-800 dark:ring-slate-700">
        <div className={`flex w-20 shrink-0 flex-col items-center justify-center px-2 py-4 sm:w-28 ${faded ? 'bg-gray-100 text-gray-600 dark:bg-slate-700/60 dark:text-slate-300' : 'bg-brand text-brand-fg'}`}>
          {tile && (
            <>
              <span className="text-[11px] font-bold uppercase tracking-[0.18em]">{tile.month}</span>
              <span className="text-[32px] font-extrabold leading-none tracking-tight tabular-nums sm:text-[40px]">{tile.day}</span>
              <span className="mt-1 text-[11px] font-semibold uppercase tracking-[0.16em]">{past ? tile.year : tile.weekday}</span>
            </>
          )}
        </div>
        <div aria-hidden className="my-3 border-l-2 border-dashed border-gray-200 dark:border-slate-600" />
        <div className="flex min-w-0 flex-1 flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:pl-6">
          <div className="min-w-0">
            <Link href={href} className="font-semibold text-gray-900 hover:underline dark:text-slate-100">
              {rsvp.event.name}
            </Link>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-sm text-gray-600 dark:text-slate-400">
              <span>{formatEventTime(rsvp.event.date, rsvp.event.timezone)}</span>
              {rsvp.event.venue && (
                <>
                  <span aria-hidden>·</span>
                  <span className="inline-flex items-center gap-1">
                    <MapPin aria-hidden className="h-3.5 w-3.5" />
                    {rsvp.event.venue.name}
                  </span>
                </>
              )}
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-1">
                <Users aria-hidden className="h-3.5 w-3.5" />
                {rsvp.partySize === 1 ? 'Just you' : `Party of ${rsvp.partySize}`}
              </span>
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {going && !past && (
              <button type="button" onClick={onCancel} disabled={busy} className="text-xs font-semibold text-brand-link hover:underline disabled:opacity-60">
                {busy ? 'Cancelling…' : 'Cancel RSVP'}
              </button>
            )}
            {!(past && going) && (
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${going ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' : 'bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-slate-300'}`}>
                {going ? 'Going' : 'Cancelled'}
              </span>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

export default function AccountRsvpsPage() {
  const { rsvps, reloadRsvps } = useAccount();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void reloadRsvps();
  }, [reloadRsvps]);

  const cancel = async (rsvp: AccountRsvp) => {
    if (!window.confirm(`Cancel your RSVP for ${rsvp.event.name}? Your spot goes back to the organizer.`)) return;
    setBusyId(rsvp.id);
    setMessage(null);
    try {
      const res = await fetch(`/api/buyer/me/rsvps/${encodeURIComponent(rsvp.id)}/cancel`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || body.error || 'Could not cancel');
      setMessage(`Your RSVP for ${rsvp.event.name} is cancelled.`);
      await reloadRsvps();
    } catch (err: any) {
      setMessage(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const upcoming = (rsvps ?? []).filter((r) => isUpcoming({ eventDate: r.event.date }));
  const past = (rsvps ?? []).filter((r) => !isUpcoming({ eventDate: r.event.date })).reverse();

  return (
    <div className="space-y-10">
      {message && (
        <p role="status" className="rounded-lg bg-white px-4 py-3 text-sm text-gray-700 ring-1 ring-gray-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700">
          {message}
        </p>
      )}
      <section aria-labelledby="rsvps-upcoming-heading">
        <h2 id="rsvps-upcoming-heading" className="mb-4 text-lg font-semibold text-gray-900 dark:text-slate-100">
          Upcoming RSVPs
        </h2>
        {rsvps === null ? (
          <p className="text-gray-600 dark:text-slate-400">Loading RSVPs…</p>
        ) : upcoming.length === 0 ? (
          <p className="flex items-center gap-3 rounded-2xl border border-dashed border-gray-300 p-6 text-gray-600 dark:border-slate-600 dark:text-slate-400">
            <CalendarCheck aria-hidden className="h-5 w-5 shrink-0 text-gray-400 dark:text-slate-500" />
            No upcoming RSVPs.
          </p>
        ) : (
          <ul className="space-y-3" aria-labelledby="rsvps-upcoming-heading">
            {upcoming.map((r) => (
              <RsvpStub key={r.id} rsvp={r} past={false} busy={busyId === r.id} onCancel={() => cancel(r)} />
            ))}
          </ul>
        )}
      </section>
      {past.length > 0 && (
        <section aria-labelledby="rsvps-past-heading">
          <h2 id="rsvps-past-heading" className="mb-4 text-lg font-semibold text-gray-900 dark:text-slate-100">
            Past
          </h2>
          <ul className="space-y-3" aria-labelledby="rsvps-past-heading">
            {past.map((r) => (
              <RsvpStub key={r.id} rsvp={r} past busy={false} onCancel={() => {}} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
