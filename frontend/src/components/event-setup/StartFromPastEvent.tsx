'use client';

// "Start from a past event" on the Name step (spec 050 §3 decision 14, §7.7),
// shown only before the draft row exists. Copies the chosen event with a new
// name and a date typed in the SOURCE event's venue zone (the copy keeps that
// venue, gotcha 28), as a draft mid-setup: POST …/duplicate {setup:true}, then
// the wizard resumes at the date step of the copy.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CopyPlus, X } from 'lucide-react';
import api from '@/services/api';
import { useDialog } from '@/lib/useDialog';
import { zonedInputToInstant } from '@/lib/eventTime';
import PastEventPicker, { type PastEvent } from './PastEventPicker';
import { clearSessionDraft } from './sessionDraft';
import { focusAfterStepChange } from './stepFocus';
import { zoneText } from './steps/VenueStep';
import { describedBy, errorText, hintClass, iconButton, inputClass, labelClass, primaryButton, secondaryButton } from './ui';

type Errors = Partial<Record<'source' | 'name' | 'date' | 'form', string>>;

function PastEventDialog({ orgId, onClose }: { orgId: string; onClose: () => void }) {
  const router = useRouter();
  const panelRef = useDialog<HTMLDivElement>(true, onClose);
  const [source, setSource] = useState<PastEvent | null>(null);
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const zone = source?.venue?.timezone ?? null;
  const instant = zonedInputToInstant(date, zone);

  const pick = (event: PastEvent) => {
    // A new edition usually keeps the name; an edited name is kept.
    if (!name || name === source?.name) setName(event.name);
    setSource(event);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next: Errors = {};
    if (!source) next.source = 'Choose the event to copy';
    if (!name.trim()) next.name = 'Enter a name for the new event';
    if (!instant) next.date = 'Enter a start date and time';
    else if (instant <= new Date()) next.date = 'Choose a start time in the future';
    setErrors(next);
    if (Object.keys(next).length || !source || !instant) return;
    setBusy(true);
    try {
      const copy = await api.post<{ id: string }>(`/organizations/${orgId}/events/${encodeURIComponent(source.id)}/duplicate`, {
        setup: true,
        name: name.trim(),
        date: instant.toISOString(),
      });
      clearSessionDraft(orgId);
      focusAfterStepChange();
      router.push(`/admin/events/${encodeURIComponent(copy.id)}/setup?step=date`);
    } catch (err) {
      setBusy(false);
      setErrors({ form: `Couldn't copy the event. ${(err as Error).message || 'Try again.'}` });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="past-event-title"
        className="flex max-h-[100dvh] w-full flex-col rounded-t-lg bg-white shadow-sm dark:bg-slate-800 sm:max-w-lg sm:rounded-lg"
      >
        <div className="flex items-center justify-between border-b border-gray-200 py-1 pl-4 pr-1 dark:border-slate-700 sm:pl-6">
          <h2 id="past-event-title" className="text-lg font-semibold text-gray-900 dark:text-white">
            Start from a past event
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className={iconButton}>
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 sm:p-6">
            <p className="text-sm text-gray-600 dark:text-slate-400">
              Copies the venue, description, image, tickets and application forms into a new draft. Orders and applications are not copied.
            </p>
            {errors.form && (
              <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
                {errors.form}
              </p>
            )}
            <PastEventPicker orgId={orgId} value={source} onChange={pick} error={errors.source} />
            <div>
              <label htmlFor="past-event-name" className={labelClass}>New event name</label>
              <input
                id="past-event-name"
                value={name}
                maxLength={255}
                onChange={(e) => setName(e.target.value)}
                aria-invalid={!!errors.name || undefined}
                aria-describedby={describedBy('past-event-name', { error: errors.name })}
                className={inputClass}
              />
              {errors.name && <p id="past-event-name-error" className={errorText}>{errors.name}</p>}
            </div>
            <div>
              <label htmlFor="past-event-date" className={labelClass}>Starts</label>
              <input
                id="past-event-date"
                type="datetime-local"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                aria-invalid={!!errors.date || undefined}
                aria-describedby={describedBy('past-event-date', { hint: true, error: errors.date })}
                className={inputClass}
              />
              <p id="past-event-date-hint" className={hintClass}>
                {source ? `At ${source.venue?.name ?? 'the venue'}: ${zoneText(zone, instant)}` : 'Choose an event first: the time is in its venue’s time zone.'}
              </p>
              {errors.date && <p id="past-event-date-error" className={errorText}>{errors.date}</p>}
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t border-gray-200 px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] dark:border-slate-700 sm:px-6">
            <button type="button" onClick={onClose} disabled={busy} className={secondaryButton}>Cancel</button>
            <button type="submit" disabled={busy} aria-busy={busy || undefined} className={primaryButton}>
              {busy ? 'Copying…' : 'Copy and continue'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function StartFromPastEvent({ orgId }: { orgId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-8 border-t border-gray-200 pt-6 dark:border-slate-700">
      <p className="text-sm text-gray-600 dark:text-slate-400">Running it again?</p>
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" className={`${secondaryButton} mt-2`}>
        <CopyPlus className="h-4 w-4" aria-hidden />
        Start from a past event
      </button>
      {open && <PastEventDialog orgId={orgId} onClose={() => setOpen(false)} />}
    </div>
  );
}
