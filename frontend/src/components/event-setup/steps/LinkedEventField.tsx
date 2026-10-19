'use client';

// "Registering for" at the top of a registration event's Where step (spec 057):
// the live event it is for, optional. Linking one fills the venue and the event
// times (start, end) from it; the registration window stays its own (When is it?).
// While the venue is the live event's, the address editor is replaced by a
// summary with "Use a different address". The link also gives the registration
// that event's floor map and a pill on its page.

import { useEffect, useState, type ReactNode } from 'react';
import { MapPin } from 'lucide-react';
import api from '@/services/api';
import { formatEventDate, formatEventDateTime, formatEventTime, instantToZonedInput } from '@/lib/eventTime';
import type { SetupFields } from '../steps';
import { hintClass, inputClass, labelClass, secondaryButton } from '../ui';
import type { StepFormProps } from './types';

export const LINKED_EVENT_FIELD = 'setup-linked-event';

interface LiveEvent {
  id: string;
  name: string;
  date: string;
  endDate?: string | null;
  status: string;
  venue: { id: string; name?: string; address?: string | null; state?: string | null; timezone?: string | null } | null;
}

/** The fields an event carries over: its venue and its times, as the wizard types them. */
function carried(e: LiveEvent | undefined): Pick<SetupFields, 'venueId' | 'date' | 'endDate'> {
  const zone = e?.venue?.timezone ?? null;
  return {
    venueId: e?.venue?.id ?? '',
    date: e ? instantToZonedInput(e.date, zone) : '',
    endDate: e?.endDate ? instantToZonedInput(e.endDate, zone) : '',
  };
}

function when(e: LiveEvent) {
  const zone = e.venue?.timezone ?? null;
  const start = formatEventDateTime(e.date, zone);
  return e.endDate ? `${start} – ${formatEventTime(e.endDate, zone)}` : start;
}

export default function LinkedEventField({
  fields,
  onChange,
  orgId,
  children,
}: Pick<StepFormProps, 'fields' | 'onChange'> & { orgId: string; children: ReactNode }) {
  const [events, setEvents] = useState<LiveEvent[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!orgId) return;
    let live = true;
    api
      .get<{ events: LiveEvent[] }>(`/organizations/${orgId}/events?type=LIVE&sort=upcoming&limit=100`)
      .then((res) => live && setEvents(res.events.filter((e) => e.status !== 'CANCELLED')))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [orgId]);

  const target = events?.find((e) => e.id === fields.linkedEventId);

  // Arriving linked (`?linked=` from the live event's page) with nothing typed yet: fill from it.
  useEffect(() => {
    if (target && !fields.venueId && !fields.date) onChange(carried(target));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.id]);

  const choose = (id: string) => {
    const next = events?.find((e) => e.id === id);
    const from = carried(events?.find((e) => e.id === fields.linkedEventId));
    const to = carried(next);
    // A value that is empty or came from the previous event follows the link;
    // one the organizer typed stays. Unlinking takes inherited values away.
    const follow = (key: 'venueId' | 'date' | 'endDate') => (!fields[key] || fields[key] === from[key] ? to[key] : fields[key]);
    onChange({ linkedEventId: id, venueId: follow('venueId'), date: follow('date'), endDate: follow('endDate') });
  };

  const inherited = !!target?.venue && fields.venueId === target.venue.id;
  const sameTimes = !!target && fields.date === carried(target).date && (fields.endDate ?? '') === carried(target).endDate;

  return (
    <div className="space-y-5">
      <div>
        <label htmlFor={LINKED_EVENT_FIELD} className={labelClass}>
          Registering for <span className="font-normal text-gray-600 dark:text-slate-400">(optional)</span>
        </label>
        <select
          id={LINKED_EVENT_FIELD}
          value={fields.linkedEventId ?? ''}
          onChange={(e) => choose(e.target.value)}
          disabled={!events && !failed}
          aria-describedby={`${LINKED_EVENT_FIELD}-hint`}
          className={inputClass}
        >
          <option value="">Not for a specific event</option>
          {(events ?? []).map((e) => (
            <option key={e.id} value={e.id}>
              {e.name} · {formatEventDate(e.date, e.venue?.timezone ?? null)}
            </option>
          ))}
        </select>
        <p id={`${LINKED_EVENT_FIELD}-hint`} className={hintClass}>
          {failed
            ? "Couldn't load your events. You can link one later."
            : 'For a market or show: registrants take its place and times, can pick a spot on its floor map, and its page links here.'}
        </p>
      </div>

      {inherited && target?.venue ? (
        <div>
          <div data-testid="linked-event-summary" className="rounded-lg border border-gray-200 p-4 dark:border-slate-700">
            <div className="flex gap-3">
              <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-gray-500 dark:text-slate-400" aria-hidden />
              <div className="min-w-0">
                <p className="font-medium text-gray-900 dark:text-white">{target.venue.name}</p>
                {target.venue.address && (
                  <p className="text-sm text-gray-700 dark:text-slate-300">
                    {[target.venue.address, target.venue.state].filter(Boolean).join(', ')}
                  </p>
                )}
                {sameTimes && <p className="mt-2 text-sm text-gray-700 dark:text-slate-300">{when(target)}</p>}
                <p className={hintClass}>
                  {sameTimes
                    ? `Same place and times as ${target.name}. You can change the times on the next step.`
                    : `Same place as ${target.name}.`}
                </p>
              </div>
            </div>
          </div>
          <button type="button" onClick={() => onChange({ venueId: '' })} className={`${secondaryButton} mt-4`}>
            Use a different address
          </button>
        </div>
      ) : (
        children
      )}
    </div>
  );
}
