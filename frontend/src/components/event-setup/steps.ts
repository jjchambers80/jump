// Event setup wizard step registry (spec 050 §5.1). The progress bar, the step
// menu, Back / Skip / Next, "Step n of N" and resume are all computed from the
// visible list here, so a step is added in one place. Keys mirror backend
// `EVENT_SETUP_STEPS` (reserved keys excluded; parity test in
// tests/unit/eventSetupSteps.test.ts against backend/tests/fixtures).
//
// Pure module: no React, no api import. Saves take the client as an argument.

import { zonedInputToIso, zonedInputToInstant } from '@/lib/eventTime';
import { DESCRIBE_STEP, IMAGE_STEP, SALES_FIELD_IDS, TICKETS_STEP, type SalesFields, type SalesSaved } from './contentSteps';
import type { EventType } from '@/lib/eventOverview';
import { flowSteps } from './formFlows';

export type StepKey =
  | 'type' | 'name' | 'venue' | 'date' | 'description' | 'image' | 'tickets' | 'attendee-questions'
  | 'registration' | 'collect-more' | 'discounts' | 'reminders' | 'review' | 'done';

/** R = required to publish, S = skippable ("Skip for now" when empty), C = conditional. */
export type StepRule = 'R' | 'S' | 'C';

/** What a step's form edits. Dates are `datetime-local` strings in the venue zone. */
export interface SetupFields extends SalesFields {
  name: string;
  slug: string;
  venueId: string;
  date: string;
  endDate: string;
  /** Spec 057: chosen on the first step, fixed once the row exists (LIVE when unset). */
  type?: EventType;
  /** Spec 057: the live event a registration event is for ('' = none). */
  linkedEventId?: string;
}

/** The server row as last saved (ISO instants), or null before step 3 creates it. */
export interface SavedEvent extends SalesSaved {
  id: string;
  name: string;
  slug: string;
  venueId: string;
  date: string | null;
  endDate: string | null;
  status: string;
  type?: EventType;
  linkedEventId?: string | null;
  admissionMode: 'TICKETED' | 'RSVP';
  setupStep: string | null;
  setupCompletedAt: string | null;
  description?: string | null;
  logoUrl?: string | null;
  capacity?: number | null;
  tierCount?: number;
  /** Add-ons on the event, every scope (overview `addOns`; kept current by Collect more). */
  addOnCount?: number;
  /** The event's floor map (overview `map`; null = none; kept current by the Floor map step). */
  mapStatus?: 'DRAFT' | 'PUBLISHED' | null;
  /** Tickets issued (not voided) or GOING RSVPs (overview): people who already hold the start time. */
  holders?: number;
}

export interface StepCtx {
  saved: SavedEvent | null;
  fields: SetupFields;
  /** Zone of the venue currently chosen in the form, and of the saved venue. */
  zone: string | null;
  savedZone: string | null;
  /** Forms on the event: old application step links resolve to their flow (spec 051). */
  forms?: { id: string; kind?: string; spaceSelection?: 'TIERS' | 'MAP' | null }[];
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

/** Spec 057: the saved row's type, else the one chosen on the first step. */
export const eventTypeOf = (ctx: Pick<StepCtx, 'saved' | 'fields'>): EventType => ctx.saved?.type ?? ctx.fields.type ?? 'LIVE';
const registration = (ctx: StepCtx) => eventTypeOf(ctx) === 'REGISTRATION';
const live = (ctx: StepCtx) => !registration(ctx);

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
  if (!ctx.fields.venueId) errors.push({ field: FIELD_IDS.venueId, step: 'venue', message: 'Add where it happens first: the time is entered in its time zone' });
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
    // Spec 057: a live event or a registration event; fixed once the row exists.
    key: 'type', title: 'What do you want to create?', rule: 'R', anchor: 'event-hero', built: true, visible: always, complete: always,
  },
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
      if ((ctx.fields.category ?? '').trim().length > 100) return [{ field: SALES_FIELD_IDS.category, message: 'Keep the category under 100 characters' }];
      return [];
    },
    payload: (ctx) => {
      if (!ctx.saved) return null;
      const body: Record<string, unknown> = {};
      const name = ctx.fields.name.trim();
      if (name && name !== ctx.saved.name) body.name = name;
      if (ctx.fields.slug && ctx.fields.slug !== ctx.saved.slug) body.slug = ctx.fields.slug;
      if (ctx.fields.category !== undefined && ctx.fields.category.trim() !== (ctx.saved.category ?? '')) body.category = ctx.fields.category.trim() || null;
      // Spec 057: a registration event's "Registering for" link.
      const linked = ctx.fields.linkedEventId || null;
      if (registration(ctx) && ctx.fields.linkedEventId !== undefined && linked !== (ctx.saved.linkedEventId ?? null)) body.linkedEventId = linked;
      return Object.keys(body).length ? body : null;
    },
    save: patchEvent,
  },
  {
    key: 'venue', title: 'Where is it?', rule: 'R', anchor: 'event-venue', built: true, visible: always,
    complete: (ctx) => !!ctx.fields.venueId,
    validate: (ctx) => (ctx.fields.venueId ? [] : [{ field: FIELD_IDS.venueId, message: 'Add where the event happens' }]),
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
  DESCRIBE_STEP,
  IMAGE_STEP,
  { ...TICKETS_STEP, visible: (ctx) => live(ctx) && TICKETS_STEP.visible(ctx) },
  { key: 'attendee-questions', title: 'Attendee questions', rule: 'S', anchor: 'tickets', built: false, reserved: true, visible: never, complete: never },
  // Spec 057: a registration event's form, set up in the `registration` form flow (formFlows.ts).
  // Opening this step goes there; the flow's last step comes back to Collect more.
  { key: 'registration', title: 'Registration form', rule: 'R', anchor: 'get-involved', built: true, visible: registration, complete: (ctx) => (ctx.forms?.length ?? 0) > 0 },
  { key: 'collect-more', title: 'Collect more', rule: 'S', anchor: 'add-ons', built: true,
    // Every admission mode: add-ons are also what vendor application tiers
    // offer, and the old editor showed them for RSVP events too (050-O parity).
    visible: always,
    complete: (ctx) => (ctx.saved?.addOnCount ?? 0) > 0,
  },
  { key: 'discounts', title: 'Discount codes', rule: 'S', anchor: 'tickets', built: false, reserved: true, visible: never, complete: never },
  // Applications, special guests, volunteers and the floor map are their own
  // flows since spec 051 (formFlows.ts), started from the event's Overview.
  { key: 'reminders', title: 'Reminders', rule: 'S', anchor: 'event-hero', built: false, reserved: true, visible: never, complete: never },
  { key: 'review', title: 'Review and publish', rule: 'R', anchor: 'event-hero', built: true, visible: always, complete: (ctx) => !!ctx.saved?.setupCompletedAt },
  { key: 'done', title: 'Your event is saved', rule: 'R', anchor: 'event-hero', built: false, visible: never, complete: never },
];

/** Per-type step lists; a donation campaign type is a second key later (§5.1). */
export const WIZARD_TYPES = { event: EVENT_STEPS } as const;

/** Steps 1–4 work before the server row exists; the rest need it. */
export const CLIENT_STEPS: StepKey[] = ['type', 'name', 'venue', 'date'];

export const stepByKey = (key: string | null | undefined): EventStep | undefined =>
  EVENT_STEPS.find((step) => step.key === key);

/** The visible steps in order: what the progress bar lists and "N" counts (Done excluded). */
export function visibleSteps(ctx: StepCtx, steps: EventStep[] = EVENT_STEPS): EventStep[] {
  return steps.filter((step) => !step.reserved && step.key !== 'done' && step.visible(ctx));
}

/** 1-based position and total, e.g. "Step 3 of 8". */
export function stepPosition(key: StepKey, ctx: StepCtx) {
  const list = visibleSteps(ctx);
  return { index: list.findIndex((step) => step.key === key) + 1, total: list.length };
}

/** Can the organizer open this step now? Later steps need the server row. */
export const isReachable = (key: StepKey, ctx: StepCtx) => !!ctx.saved || CLIENT_STEPS.includes(key);

/** Spec 050 application steps, now flows (spec 051): still in old drafts' `setupStep`. */
export const FORMER_STEPS = new Set(['vendors', 'floor-map', 'special-guests', 'volunteers', 'other-applications']);

/**
 * Where a visit resumes. A saved `setupStep` that is still visible wins; one
 * that is hidden now (a MAP form became TIERS) resumes at the next visible step
 * after it. A fresh row (no step yet) resumes after the date step that created it.
 */
export function resumeKey(ctx: StepCtx, setupStep: string | null | undefined): StepKey {
  const list = visibleSteps(ctx);
  // A draft saved on an application step before spec 051 moved them out: those came after Collect more.
  const target = setupStep && FORMER_STEPS.has(setupStep) ? 'review' : setupStep ?? (ctx.saved ? 'description' : null);
  const at = EVENT_STEPS.findIndex((step) => step.key === target);
  if (at >= 0) {
    const next = EVENT_STEPS.slice(at).find((step) => list.includes(step));
    if (next && isReachable(next.key, ctx)) return next.key;
  }
  return list[0].key;
}

/** Neighbours in the visible list for Back and Next. */
export function neighbours(key: StepKey, ctx: StepCtx) {
  const list = visibleSteps(ctx);
  const at = list.findIndex((step) => step.key === key);
  return { prev: at > 0 ? list[at - 1] : null, next: at >= 0 && at < list.length - 1 ? list[at + 1] : null };
}

/**
 * Spec 057: "Step n of N" for one wizard across a registration event's steps
 * and its form flow, which stands in the `registration` slot. `key` is an
 * event step, or null inside the flow at `flowAt` of `flowTotal` steps.
 * A live event has no slot and counts its own list.
 */
export function wizardProgress(ctx: StepCtx, key: StepKey | null, flowAt = 0, flowTotal = 1) {
  const list = visibleSteps(ctx);
  const slot = list.findIndex((step) => step.key === 'registration');
  const extra = slot >= 0 ? flowTotal - 1 : 0;
  if (key === null) return { index: slot + flowAt + 1, total: list.length + extra };
  const at = list.findIndex((step) => step.key === key);
  return { index: at + 1 + (slot >= 0 && at > slot ? extra : 0), total: list.length + extra };
}

/** The steps of a registration event's form flow for the form on it (none yet = before Start). */
export const registrationFlowSteps = (ctx: Pick<StepCtx, 'saved' | 'forms'>, { maps = true } = {}) => {
  const form = ctx.forms?.[0];
  return flowSteps('registration', form ? { kind: (form.kind as 'FREE' | 'PAID') ?? 'FREE', spaceSelection: form.spaceSelection } : null, {
    maps,
    mapEvent: !!ctx.saved?.linkedEventId,
  });
};
