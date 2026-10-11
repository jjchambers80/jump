// Event setup wizard step registry (spec 050 §5.1). The progress bar, the step
// menu, Back / Skip / Next, "Step n of N" and resume are all computed from the
// visible list here, so a step is added in one place. Keys mirror backend
// `EVENT_SETUP_STEPS` (reserved keys excluded; parity test in
// tests/unit/eventSetupSteps.test.ts against backend/tests/fixtures).
//
// Pure module: no React, no api import. Saves take the client as an argument.

import { zonedInputToIso, zonedInputToInstant } from '@/lib/eventTime';

export type StepKey =
  | 'name' | 'venue' | 'date' | 'description' | 'image' | 'tickets' | 'attendee-questions'
  | 'collect-more' | 'discounts' | 'vendors' | 'floor-map' | 'special-guests' | 'volunteers'
  | 'other-applications' | 'reminders' | 'review' | 'done';

/** R = required to publish, S = skippable ("Skip for now" when empty), C = conditional. */
export type StepRule = 'R' | 'S' | 'C';

/** What a step's form edits. Dates are `datetime-local` strings in the venue zone. */
export interface SetupFields {
  name: string;
  slug: string;
  venueId: string;
  date: string;
  endDate: string;
}

/** The server row as last saved (ISO instants), or null before step 3 creates it. */
export interface SavedEvent {
  id: string;
  name: string;
  slug: string;
  venueId: string;
  date: string | null;
  endDate: string | null;
  status: string;
  admissionMode: 'TICKETED' | 'RSVP';
  setupStep: string | null;
  setupCompletedAt: string | null;
  description?: string | null;
  logoUrl?: string | null;
  capacity?: number | null;
  tierCount?: number;
}

export interface StepCtx {
  saved: SavedEvent | null;
  fields: SetupFields;
  /** Zone of the venue currently chosen in the form, and of the saved venue. */
  zone: string | null;
  savedZone: string | null;
  /** Forms on the event (050-L fills purpose and spaceSelection). */
  forms?: { spaceSelection?: 'TIERS' | 'MAP' | null }[];
  donationsEligible?: boolean;
  now?: Date;
}

export interface FieldError {
  /** The input's id: the error summary links to it. */
  field: string;
  message: string;
  /** Set when the field lives on another step: the summary link opens that step. */
  step?: StepKey;
}

export interface PatchClient {
  patch: <T = unknown>(endpoint: string, body: unknown) => Promise<T>;
}

export interface EventStep {
  key: StepKey;
  title: string;
  rule: StepRule;
  /** Element id in the preview the pane scrolls to. */
  anchor: string;
  /** Reserved slots (§5.1) never show in v1. */
  reserved?: boolean;
  /** Built by this card or a later one (050-J…N); unbuilt steps show a holding page. */
  built: boolean;
  visible: (ctx: StepCtx) => boolean;
  complete: (ctx: StepCtx) => boolean;
  validate?: (ctx: StepCtx) => FieldError[];
  /** The PATCH body for what changed since the last save, or null when nothing did. */
  payload?: (ctx: StepCtx) => Record<string, unknown> | null;
  save?: (client: PatchClient, ids: { orgId: string; eventId: string }, body: Record<string, unknown>) => Promise<unknown>;
}

export const FIELD_IDS = {
  name: 'setup-name',
  slug: 'setup-slug',
  venueId: 'setup-venue',
  date: 'setup-date',
  endDate: 'setup-end-date',
} as const;

const always = () => true;
const never = () => false;
const ticketed = (ctx: StepCtx) => (ctx.saved?.admissionMode ?? 'TICKETED') === 'TICKETED';

export const patchEvent = (client: PatchClient, { orgId, eventId }: { orgId: string; eventId: string }, body: Record<string, unknown>) =>
  client.patch(`/organizations/${orgId}/events/${eventId}`, body);

export const sameInstant = (a: string | null, b: string | null) =>
  (a ? new Date(a).getTime() : null) === (b ? new Date(b).getTime() : null);

/** Start and end as ISO in the form's venue zone. */
const formDates = (ctx: StepCtx) => ({
  date: zonedInputToIso(ctx.fields.date, ctx.zone),
  endDate: zonedInputToIso(ctx.fields.endDate, ctx.zone),
});

function datePayload(ctx: StepCtx): Record<string, unknown> | null {
  if (!ctx.saved) return null;
  const { date, endDate } = formDates(ctx);
  const body: Record<string, unknown> = {};
  if (date && !sameInstant(date, ctx.saved.date)) body.date = date;
  if (!sameInstant(endDate, ctx.saved.endDate)) body.endDate = endDate;
  return Object.keys(body).length ? body : null;
}

export function validateDates(ctx: StepCtx): FieldError[] {
  const errors: FieldError[] = [];
  if (!ctx.fields.venueId) errors.push({ field: FIELD_IDS.venueId, step: 'venue', message: 'Choose a venue first: the time is entered in its time zone' });
  const start = zonedInputToInstant(ctx.fields.date, ctx.zone);
  const end = zonedInputToInstant(ctx.fields.endDate, ctx.zone);
  if (!start) errors.push({ field: FIELD_IDS.date, message: 'Enter a start date and time' });
  // A saved start that has passed may stay as it is (editing a past event's other fields).
  else if (start <= (ctx.now ?? new Date()) && !sameInstant(start.toISOString(), ctx.saved?.date ?? null))
    errors.push({ field: FIELD_IDS.date, message: 'Choose a start time in the future' });
  if (ctx.fields.endDate && !end) errors.push({ field: FIELD_IDS.endDate, message: 'Enter a valid end time, or remove it' });
  else if (start && end && end <= start) errors.push({ field: FIELD_IDS.endDate, message: 'End time must be after the start time' });
  return errors;
}

export const EVENT_STEPS: EventStep[] = [
  {
    key: 'name', title: 'Name your event', rule: 'R', anchor: 'event-hero', built: true,
    // Plan §5.1 hides it in create mode once the row exists; kept visible so the
    // count never shifts under the organizer (050-I's "Start from a past event"
    // is what is create-only, before the row).
    visible: always,
    complete: (ctx) => !!ctx.fields.name.trim(),
    validate: (ctx) => {
      const name = ctx.fields.name.trim();
      if (!name) return [{ field: FIELD_IDS.name, message: 'Enter a name for your event' }];
      if (name.length > 255) return [{ field: FIELD_IDS.name, message: 'Keep the name under 255 characters' }];
      return [];
    },
    payload: (ctx) => {
      if (!ctx.saved) return null;
      const body: Record<string, unknown> = {};
      const name = ctx.fields.name.trim();
      if (name && name !== ctx.saved.name) body.name = name;
      if (ctx.fields.slug && ctx.fields.slug !== ctx.saved.slug) body.slug = ctx.fields.slug;
      return Object.keys(body).length ? body : null;
    },
    save: patchEvent,
  },
  {
    key: 'venue', title: 'Where is it?', rule: 'R', anchor: 'event-venue', built: true, visible: always,
    complete: (ctx) => !!ctx.fields.venueId,
    validate: (ctx) => (ctx.fields.venueId ? [] : [{ field: FIELD_IDS.venueId, message: 'Choose a venue' }]),
    payload: (ctx) => {
      if (!ctx.saved || !ctx.fields.venueId || ctx.fields.venueId === ctx.saved.venueId) return null;
      // The typed wall-clock time stays and moves to the new venue's zone (spec 033).
      const dates = datePayload(ctx);
      return { venueId: ctx.fields.venueId, ...dates };
    },
    save: patchEvent,
  },
  {
    key: 'date', title: 'When is it?', rule: 'R', anchor: 'event-date', built: true, visible: always,
    complete: (ctx) => !!ctx.fields.date,
    validate: validateDates,
    payload: datePayload,
    save: patchEvent,
  },
  { key: 'description', title: 'Describe it', rule: 'S', anchor: 'about', built: false, visible: always, complete: (ctx) => !!ctx.saved?.description },
  { key: 'image', title: 'Add an image', rule: 'S', anchor: 'event-hero-image', built: false, visible: always, complete: (ctx) => !!ctx.saved?.logoUrl },
  {
    key: 'tickets', title: 'Tickets or RSVP', rule: 'R', anchor: 'tickets', built: false, visible: always,
    complete: (ctx) => !ticketed(ctx) || (!!ctx.saved?.capacity && (ctx.saved?.tierCount ?? 0) > 0),
  },
  { key: 'attendee-questions', title: 'Attendee questions', rule: 'S', anchor: 'tickets', built: false, reserved: true, visible: never, complete: never },
  { key: 'collect-more', title: 'Collect more', rule: 'S', anchor: 'add-ons', built: false, visible: (ctx) => ticketed(ctx) || !!ctx.donationsEligible, complete: never },
  { key: 'discounts', title: 'Discount codes', rule: 'S', anchor: 'tickets', built: false, reserved: true, visible: never, complete: never },
  { key: 'vendors', title: 'Vendor applications', rule: 'S', anchor: 'get-involved', built: false, visible: always, complete: never },
  { key: 'floor-map', title: 'Floor map', rule: 'C', anchor: 'floor-map', built: false, visible: (ctx) => !!ctx.forms?.some((f) => f.spaceSelection === 'MAP'), complete: never },
  { key: 'special-guests', title: 'Special guests', rule: 'S', anchor: 'get-involved', built: false, visible: always, complete: never },
  { key: 'volunteers', title: 'Volunteers', rule: 'S', anchor: 'get-involved', built: false, visible: always, complete: never },
  { key: 'other-applications', title: 'Other applications', rule: 'S', anchor: 'get-involved', built: false, visible: always, complete: never },
  { key: 'reminders', title: 'Reminders', rule: 'S', anchor: 'event-hero', built: false, reserved: true, visible: never, complete: never },
  { key: 'review', title: 'Review and publish', rule: 'R', anchor: 'event-hero', built: false, visible: always, complete: (ctx) => !!ctx.saved?.setupCompletedAt },
  { key: 'done', title: 'Your event is saved', rule: 'R', anchor: 'event-hero', built: false, visible: never, complete: never },
];

/** Per-type step lists; a donation campaign type is a second key later (§5.1). */
export const WIZARD_TYPES = { event: EVENT_STEPS } as const;

/** Steps 1–3 work before the server row exists; the rest need it. */
export const CLIENT_STEPS: StepKey[] = ['name', 'venue', 'date'];

export const stepByKey = (key: string | null | undefined): EventStep | undefined =>
  EVENT_STEPS.find((step) => step.key === key);

/** The visible steps in order: what the progress bar lists and "N" counts (Done excluded). */
export function visibleSteps(ctx: StepCtx, steps: EventStep[] = EVENT_STEPS): EventStep[] {
  return steps.filter((step) => !step.reserved && step.key !== 'done' && step.visible(ctx));
}

/** 1-based position and total, e.g. "Step 3 of 12". */
export function stepPosition(key: StepKey, ctx: StepCtx) {
  const list = visibleSteps(ctx);
  return { index: list.findIndex((step) => step.key === key) + 1, total: list.length };
}

/** Can the organizer open this step now? Later steps need the server row. */
export const isReachable = (key: StepKey, ctx: StepCtx) => !!ctx.saved || CLIENT_STEPS.includes(key);

/**
 * Where a visit resumes. A saved `setupStep` that is still visible wins; one
 * that is hidden now (a MAP form became TIERS) resumes at the next visible step
 * after it. A fresh row (no step yet) resumes after the date step that created it.
 */
export function resumeKey(ctx: StepCtx, setupStep: string | null | undefined): StepKey {
  const list = visibleSteps(ctx);
  const target = setupStep ?? (ctx.saved ? 'description' : null);
  const at = EVENT_STEPS.findIndex((step) => step.key === target);
  if (at >= 0) {
    const next = EVENT_STEPS.slice(at).find((step) => list.includes(step));
    if (next && isReachable(next.key, ctx)) return next.key;
  }
  return list[0].key;
}

export type StepState = 'complete' | 'current' | 'skipped' | 'todo';

/** Progress state per step: text + icon in the UI, never colour alone. */
export function stepState(step: EventStep, current: StepKey, ctx: StepCtx): StepState {
  if (step.key === current) return 'current';
  if (step.complete(ctx)) return 'complete';
  const list = visibleSteps(ctx);
  const furthest = Math.max(list.findIndex((s) => s.key === ctx.saved?.setupStep), list.findIndex((s) => s.key === current));
  return step.rule !== 'R' && list.indexOf(step) < furthest ? 'skipped' : 'todo';
}

/** Neighbours in the visible list for Back and Next. */
export function neighbours(key: StepKey, ctx: StepCtx) {
  const list = visibleSteps(ctx);
  const at = list.findIndex((step) => step.key === key);
  return { prev: at > 0 ? list[at - 1] : null, next: at >= 0 && at < list.length - 1 ? list[at + 1] : null };
}
