// Pure helpers for the wizard's volunteer shift editor (spec 050 §6.4, card
// 050-S). No React, no api import, so Vitest can pin them.

import { zonedInputToInstant } from '@/lib/eventTime';

export interface ShiftDraft {
  name: string;
  /** `datetime-local` strings in the venue zone (gotcha 28). */
  start: string;
  end: string;
  /** Empty = unlimited. */
  capacity: string;
}

export type ShiftField = 'name' | 'start' | 'end' | 'capacity';

/** Field errors the server would also refuse (400), caught before the round trip. */
export function validateShiftDraft(draft: ShiftDraft, zone: string | null | undefined): Partial<Record<ShiftField, string>> {
  const errors: Partial<Record<ShiftField, string>> = {};
  const name = draft.name.trim();
  if (!name) errors.name = 'Enter a name or role';
  else if (name.length > 80) errors.name = 'Keep the name to 80 characters or fewer';
  const start = zonedInputToInstant(draft.start, zone);
  const end = zonedInputToInstant(draft.end, zone);
  if (draft.start && !start) errors.start = 'Enter a valid start time, or clear it';
  if (draft.end && !end) errors.end = 'Enter a valid end time, or clear it';
  else if (end && !draft.start) errors.end = 'Add a start time before an end time';
  else if (start && end && end <= start) errors.end = 'End time must be after the start time';
  if (draft.capacity.trim()) {
    const n = Number(draft.capacity);
    if (!Number.isInteger(n) || n < 1 || n > 100000) errors.capacity = 'Enter a whole number of at least 1, or leave it empty for no limit';
  }
  return errors;
}

/**
 * Soft check, never a block: setup and teardown shifts legitimately sit
 * outside the event. Without an event end only "starts before" is known.
 */
export function outsideEventWarning(
  shift: { startsAt: string | null; endsAt: string | null },
  eventStart: string | null | undefined,
  eventEnd: string | null | undefined
): string | null {
  if (!shift.startsAt || !eventStart) return null;
  const start = new Date(shift.startsAt).getTime();
  const last = new Date(shift.endsAt ?? shift.startsAt).getTime();
  const before = start < new Date(eventStart).getTime();
  const after = !!eventEnd && last > new Date(eventEnd).getTime();
  if (before && after) return 'Runs outside the event times, before it starts and after it ends. Fine for setup or teardown.';
  if (before) return 'Starts before the event does. Fine for a setup shift.';
  if (after) return 'Ends after the event does. Fine for a teardown shift.';
  return null;
}

/** The server's 409s, in words that say what to do next. */
export function shiftErrorText(err: unknown, shiftName: string, fallback: string): string {
  const e = err as { code?: string; message?: string; details?: { assigned?: number } } | undefined;
  const n = e?.details?.assigned ?? 0;
  const people = `${n} volunteer${n === 1 ? ' is' : 's are'}`;
  if (e?.code === 'SHIFT_CAPACITY_BELOW_ASSIGNED')
    return `${people} already assigned to ${shiftName}. Set the capacity to at least ${n}, or leave it empty for no limit.`;
  if (e?.code === 'SHIFT_HAS_ASSIGNED')
    return `${shiftName} can't be deleted: ${people} assigned to it. Move them to another shift from their applications first.`;
  return e?.message || fallback;
}
