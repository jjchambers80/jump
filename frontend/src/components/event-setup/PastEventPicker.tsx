'use client';

// Searchable list of the organization's events for "Start from a past event"
// (spec 050-I). Server search (`q`, newest first), debounced; the choice is a
// native radio group, so arrow keys move through it. Dates show in each
// event's own venue zone (gotcha 28).

import { useEffect, useState } from 'react';
import api from '@/services/api';
import { formatEventDate } from '@/lib/eventTime';
import { inputClass, labelClass, secondaryButton } from './ui';

export interface PastEvent {
  id: string;
  name: string;
  date: string;
  status: string;
  venue: { name: string; timezone?: string | null } | null;
}

type Load = { status: 'loading' } | { status: 'error' } | { status: 'ready'; events: PastEvent[] };

export default function PastEventPicker({
  orgId,
  value,
  onChange,
  error,
}: {
  orgId: string;
  value: PastEvent | null;
  onChange: (event: PastEvent) => void;
  error?: string;
}) {
  const [q, setQ] = useState('');
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoad({ status: 'loading' });
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ sort: 'date_desc', limit: '20' });
      if (q.trim()) params.set('q', q.trim());
      api
        .get<{ events: PastEvent[] }>(`/organizations/${orgId}/events?${params}`)
        .then((res) => !cancelled && setLoad({ status: 'ready', events: res.events }))
        .catch(() => !cancelled && setLoad({ status: 'error' }));
    }, q ? 250 : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [orgId, q, attempt]);

  return (
    <div className="space-y-2">
      <label htmlFor="past-event-search" className={labelClass}>
        Search your events
      </label>
      <input id="past-event-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" className={inputClass} />
      <fieldset aria-describedby={error ? 'past-event-error' : undefined} aria-busy={load.status === 'loading' || undefined}>
        <legend className="sr-only">Event to copy</legend>
        {load.status === 'loading' && (
          <div className="space-y-2" aria-label="Loading events">
            <div className="h-14 animate-pulse rounded-md bg-gray-200 dark:bg-slate-700" />
            <div className="h-14 animate-pulse rounded-md bg-gray-200 dark:bg-slate-700" />
          </div>
        )}
        {load.status === 'error' && (
          <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-red-700 dark:text-red-400">
            Couldn&apos;t load your events.
            <button type="button" onClick={() => setAttempt((n) => n + 1)} className={secondaryButton}>
              Try again
            </button>
          </div>
        )}
        {load.status === 'ready' && load.events.length === 0 && (
          <p className="py-3 text-sm text-gray-600 dark:text-slate-400">{q ? `No events match “${q}”.` : 'No events yet. Start from scratch instead.'}</p>
        )}
        {load.status === 'ready' && load.events.length > 0 && (
          <ul className="max-h-64 divide-y divide-gray-200 overflow-y-auto rounded-md border border-gray-200 dark:divide-slate-700 dark:border-slate-700">
            {load.events.map((event) => (
              <li key={event.id}>
                <label className="flex min-h-14 cursor-pointer items-center gap-3 px-3 py-2 hover:bg-gray-50 has-[:checked]:bg-accent-50 dark:hover:bg-slate-700/60 dark:has-[:checked]:bg-slate-700">
                  <input
                    type="radio"
                    name="past-event"
                    value={event.id}
                    checked={value?.id === event.id}
                    onChange={() => onChange(event)}
                    className="h-4 w-4 shrink-0 accent-accent-600"
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-gray-900 dark:text-white">{event.name}</span>
                    <span className="block truncate text-xs text-gray-600 dark:text-slate-400">
                      {formatEventDate(event.date, event.venue?.timezone)}
                      {event.venue ? ` · ${event.venue.name}` : ''}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>
      {error && (
        <p id="past-event-error" className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
