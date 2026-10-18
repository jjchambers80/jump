'use client';

// "Registering for" on a registration event's Name step (spec 057): the live
// event it is for, optional. Picking one before the row exists fills an empty
// venue and date from it; the link also gives the registration that event's
// floor map and a pill on its page.

import { useEffect, useState } from 'react';
import api from '@/services/api';
import { formatEventDate, instantToZonedInput } from '@/lib/eventTime';
import { hintClass, inputClass, labelClass } from '../ui';
import type { StepFormProps } from './types';

export const LINKED_EVENT_FIELD = 'setup-linked-event';

interface LiveEvent {
  id: string;
  name: string;
  date: string;
  status: string;
  venue: { id: string; timezone?: string | null } | null;
}

export default function LinkedEventField({ fields, onChange, orgId, hasRow }: StepFormProps & { orgId: string; hasRow: boolean }) {
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

  const choose = (id: string) => {
    const target = events?.find((e) => e.id === id);
    const previous = events?.find((e) => e.id === fields.linkedEventId);
    // A venue that came from the event it was registering for leaves with that
    // event, so the Where step asks for an address again.
    const inherited = !!fields.venueId && previous?.venue?.id === fields.venueId;
    const venueId = inherited ? '' : fields.venueId;
    // Before the row exists, an empty venue and date come from the event (both stay editable).
    const fill = !hasRow && target
      ? {
          ...(!venueId && target.venue && { venueId: target.venue.id }),
          ...(!fields.date && { date: instantToZonedInput(target.date, target.venue?.timezone ?? null) }),
        }
      : {};
    onChange({ linkedEventId: id, ...(inherited && { venueId }), ...fill });
  };

  return (
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
          : 'Registrants for a market or show: they can pick a spot on its floor map, and its page links here.'}
      </p>
    </div>
  );
}
