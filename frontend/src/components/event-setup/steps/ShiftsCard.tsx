'use client';

// Shifts on a volunteer form in the wizard's Volunteers step (spec 050 §6.4,
// card 050-S): list, add, edit, delete. Times are the venue's wall clock
// (gotcha 28) with the zone always written out. A shift outside the event
// times gets a soft warning only: setup and teardown shifts are real. The
// server's 409s (capacity below the assigned count, delete while assigned)
// are shown in words. Every save reloads the forms and bumps the preview.

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Pencil, Plus, Trash2 } from 'lucide-react';
import { DEFAULT_ZONE, formatEventDateTime, instantToZonedInput, zonedInputToInstant, zonedInputToIso } from '@/lib/eventTime';
import { shiftWhen, type AdminForm, type AdminShift } from '@/lib/applications';
import type { useApplicationsApi } from '@/app/admin/events/[eventId]/applications/useApplicationsApi';
import { outsideEventWarning, shiftErrorText, validateShiftDraft, type ShiftDraft, type ShiftField } from '../shiftEditor';
import { describedBy, errorText, hintClass, iconButton, inputClass, labelClass, primaryButton, secondaryButton, textButton } from '../ui';
import { zoneText } from './VenueStep';

interface Props {
  form: AdminForm;
  api: ReturnType<typeof useApplicationsApi>;
  canEdit: boolean;
  /** The event's start and optional end (ISO), for the outside-the-event warning. */
  eventStart?: string | null;
  eventEnd?: string | null;
  /** After any save: reload the forms and refresh the preview. */
  onSaved: () => void;
}

const card = 'rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-5';
const alertClass = 'rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200';
const EMPTY: ShiftDraft = { name: '', start: '', end: '', capacity: '' };

function capacityText(s: AdminShift) {
  if (s.capacity == null) return `No limit · ${s.assigned} assigned`;
  return `${s.assigned} of ${s.capacity} assigned`;
}

export default function ShiftsCard({ form, api, canEdit, eventStart, eventEnd, onSaved }: Props) {
  const zone = form.timezone ?? null;
  const shifts = form.shifts ?? [];
  const [editing, setEditing] = useState<'new' | string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [focusId, setFocusId] = useState<string | null>(null);
  const headingId = `setup-shifts-heading-${form.id}`;
  const addId = `setup-shift-add-${form.id}`;

  // Focus after a close or delete, once the reloaded list renders the target.
  useEffect(() => {
    const el = focusId && document.getElementById(focusId);
    if (!el) return;
    el.focus();
    setFocusId(null);
  }, [focusId, shifts]);

  const close = (target: string) => {
    setEditing(null);
    setFocusId(target);
  };

  const remove = async (shift: AdminShift) => {
    if (!window.confirm(`Delete the "${shift.name}" shift? This can't be undone.`)) return;
    setBusy(true);
    setError(null);
    setNotice('');
    try {
      await api.deleteShift(form.id, shift.id);
      onSaved();
      setNotice(`${shift.name} deleted.`);
      setFocusId(headingId);
    } catch (err) {
      setError(shiftErrorText(err, shift.name, "Couldn't delete the shift"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={card} aria-labelledby={headingId} data-testid="setup-shifts">
      <h2 id={headingId} tabIndex={-1} className="text-base font-semibold text-gray-900 focus:outline-none dark:text-white">
        Shifts and roles
      </h2>
      <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
        Volunteers pick the shifts they&apos;d like; you assign them when you approve. Leave the times empty for a role without a set time.
      </p>
      <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
        Times are in the venue&apos;s time zone: <span className="font-medium text-gray-900 dark:text-white">{zoneText(zone)}</span>
      </p>
      <p role="status" className="sr-only">{notice}</p>
      {error && (
        <p role="alert" className={`${alertClass} mt-3`}>
          {error}
        </p>
      )}

      {shifts.length === 0 && editing !== 'new' && <p className="mt-3 text-sm text-gray-700 dark:text-slate-300">No shifts yet. Volunteers can still apply without picking one.</p>}
      {shifts.length > 0 && (
        <ul className="mt-3 divide-y divide-gray-200 dark:divide-slate-700">
          {shifts.map((s) =>
            editing === s.id ? (
              <li key={s.id} className="py-3">
                <ShiftEditor
                  form={form}
                  shift={s}
                  zone={zone}
                  eventStart={eventStart}
                  eventEnd={eventEnd}
                  save={(body) => api.updateShift(form.id, s.id, body)}
                  onDone={(saved) => {
                    if (saved) {
                      onSaved();
                      setNotice(`${saved} saved.`);
                    }
                    close(`setup-shift-edit-${s.id}`);
                  }}
                />
              </li>
            ) : (
              <ShiftRow key={s.id} shift={s} zone={zone} warning={outsideEventWarning(s, eventStart, eventEnd)} canEdit={canEdit} busy={busy || editing !== null} onEdit={() => setEditing(s.id)} onDelete={() => void remove(s)} />
            )
          )}
        </ul>
      )}

      {editing === 'new' ? (
        <div className="mt-3 border-t border-gray-200 pt-3 dark:border-slate-700">
          <ShiftEditor
            form={form}
            shift={null}
            zone={zone}
            eventStart={eventStart}
            eventEnd={eventEnd}
            save={(body) => api.addShift(form.id, body)}
            onDone={(saved) => {
              if (saved) {
                onSaved();
                setNotice(`${saved} added.`);
              }
              close(addId);
            }}
          />
        </div>
      ) : (
        canEdit && (
          <button id={addId} type="button" disabled={busy || editing !== null} onClick={() => setEditing('new')} className={`${secondaryButton} mt-3`}>
            <Plus className="h-4 w-4" aria-hidden />
            Add a shift
          </button>
        )
      )}
    </section>
  );
}

function ShiftRow({
  shift,
  zone,
  warning,
  canEdit,
  busy,
  onEdit,
  onDelete,
}: {
  shift: AdminShift;
  zone: string | null;
  warning: string | null;
  canEdit: boolean;
  busy: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <li className="flex items-start justify-between gap-2 py-3" data-testid={`setup-shift-${shift.id}`}>
      <div className="min-w-0">
        <p className="break-words font-medium text-gray-900 dark:text-white">{shift.name}</p>
        <p className="text-sm text-gray-700 dark:text-slate-300">{shiftWhen(shift, zone) ?? 'No set time'}</p>
        <p className="text-sm text-gray-600 dark:text-slate-400">{capacityText(shift)}</p>
        {warning && (
          <p className="mt-1 flex items-start gap-1.5 text-sm text-amber-800 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              <span className="sr-only">Note: </span>
              {warning}
            </span>
          </p>
        )}
      </div>
      {canEdit && (
        <div className="flex shrink-0">
          <button id={`setup-shift-edit-${shift.id}`} type="button" disabled={busy} onClick={onEdit} className={iconButton} aria-label={`Edit ${shift.name}`}>
            <Pencil className="h-4 w-4" aria-hidden />
          </button>
          <button type="button" disabled={busy} onClick={onDelete} className={iconButton} aria-label={`Delete ${shift.name}`}>
            <Trash2 className="h-4 w-4" aria-hidden />
          </button>
        </div>
      )}
    </li>
  );
}

function TimeInput({ id, label, value, zone, error, onChange }: { id: string; label: string; value: string; zone: string | null; error?: string; onChange: (v: string) => void }) {
  const instant = zonedInputToInstant(value, zone);
  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <input
        id={id}
        type="datetime-local"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={!!error || undefined}
        aria-describedby={describedBy(id, { hint: true, error })}
        className={inputClass}
      />
      <p id={`${id}-hint`} className={hintClass}>
        {instant ? `${formatEventDateTime(instant, zone || DEFAULT_ZONE)} at the venue` : `Optional. Venue time: ${zoneText(zone)}`}
      </p>
      {error && (
        <p id={`${id}-error`} className={errorText}>
          {error}
        </p>
      )}
    </div>
  );
}

/** Inline add / edit form. `onDone(name)` after a save, `onDone(null)` on cancel. */
function ShiftEditor({
  form,
  shift,
  zone,
  eventStart,
  eventEnd,
  save,
  onDone,
}: {
  form: AdminForm;
  shift: AdminShift | null;
  zone: string | null;
  eventStart?: string | null;
  eventEnd?: string | null;
  save: (body: { name: string; startsAt: string | null; endsAt: string | null; capacity: number | null }) => Promise<unknown>;
  onDone: (savedName: string | null) => void;
}) {
  const [draft, setDraft] = useState<ShiftDraft>(() =>
    shift
      ? { name: shift.name, start: instantToZonedInput(shift.startsAt, zone), end: instantToZonedInput(shift.endsAt, zone), capacity: shift.capacity == null ? '' : String(shift.capacity) }
      : EMPTY
  );
  const [errors, setErrors] = useState<Partial<Record<ShiftField, string>>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const prefix = `setup-shift-${shift?.id ?? `new-${form.id}`}`;
  const ids = { name: `${prefix}-name`, start: `${prefix}-start`, end: `${prefix}-end`, capacity: `${prefix}-capacity` };

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const set = (patch: Partial<ShiftDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const startsAt = zonedInputToIso(draft.start, zone);
  const endsAt = zonedInputToIso(draft.end, zone);
  const warning = outsideEventWarning({ startsAt, endsAt }, eventStart, eventEnd);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const found = validateShiftDraft(draft, zone);
    setErrors(found);
    setServerError(null);
    const first = (Object.keys(ids) as ShiftField[]).find((k) => found[k]);
    if (first) {
      document.getElementById(ids[first])?.focus();
      return;
    }
    const name = draft.name.trim();
    setSaving(true);
    try {
      await save({ name, startsAt, endsAt, capacity: draft.capacity.trim() ? Number(draft.capacity) : null });
      onDone(name);
    } catch (err) {
      setServerError(shiftErrorText(err, shift?.name ?? name, "Couldn't save the shift"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4" aria-label={shift ? `Edit ${shift.name}` : 'New shift'} data-testid="setup-shift-editor">
      {serverError && (
        <p role="alert" className={alertClass}>
          {serverError}
        </p>
      )}
      <div>
        <label htmlFor={ids.name} className={labelClass}>
          Shift or role name
        </label>
        <input
          ref={nameRef}
          id={ids.name}
          value={draft.name}
          maxLength={80}
          onChange={(e) => set({ name: e.target.value })}
          aria-invalid={!!errors.name || undefined}
          aria-describedby={describedBy(ids.name, { error: errors.name })}
          className={inputClass}
          placeholder="Gate crew, Saturday morning"
        />
        {errors.name && (
          <p id={`${ids.name}-error`} className={errorText}>
            {errors.name}
          </p>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TimeInput id={ids.start} label="Starts" value={draft.start} zone={zone} error={errors.start} onChange={(start) => set({ start })} />
        <TimeInput id={ids.end} label="Ends" value={draft.end} zone={zone} error={errors.end} onChange={(end) => set({ end })} />
      </div>
      {warning && (
        <p className="flex items-start gap-1.5 text-sm text-amber-800 dark:text-amber-300" data-testid="setup-shift-outside-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{warning}</span>
        </p>
      )}
      <div>
        <label htmlFor={ids.capacity} className={labelClass}>
          Volunteers needed
        </label>
        <input
          id={ids.capacity}
          type="number"
          inputMode="numeric"
          min={1}
          step={1}
          value={draft.capacity}
          onChange={(e) => set({ capacity: e.target.value })}
          aria-invalid={!!errors.capacity || undefined}
          aria-describedby={describedBy(ids.capacity, { hint: true, error: errors.capacity })}
          className={inputClass}
        />
        <p id={`${ids.capacity}-hint`} className={hintClass}>
          Leave empty for no limit. {shift && shift.assigned > 0 ? `${shift.assigned} already assigned.` : ''}
        </p>
        {errors.capacity && (
          <p id={`${ids.capacity}-error`} className={errorText}>
            {errors.capacity}
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={saving} className={primaryButton}>
          {saving ? 'Saving…' : shift ? 'Save shift' : 'Add shift'}
        </button>
        <button type="button" disabled={saving} onClick={() => onDone(null)} className={textButton}>
          Cancel
        </button>
      </div>
    </form>
  );
}
