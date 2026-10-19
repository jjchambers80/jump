// Steps 4–6 of the event setup wizard (spec 050 §5.1, card 050-J): Describe
// it, Add an image, Tickets or RSVP. Kept beside the registry so steps.ts only
// lists them. What saves through the event PATCH (description, category,
// admission mode, capacity, RSVP settings) is a payload here; the image and the
// tiers save on their own (upload, tier dialog) and refresh the preview.
//
// Pure module, type-only imports from steps.ts (it imports this file).

import type { OverviewTier } from '@/lib/eventOverview';
import type { EventTax } from '@/components/events/EventTaxSummary';
import type { EventStep, FieldError, PatchClient, StepCtx } from './steps';

export type AdmissionMode = 'TICKETED' | 'RSVP';

/** Form fields of steps 4 and 6; unset until the row is loaded. */
export interface SalesFields {
  description?: string;
  category?: string;
  admissionMode?: AdmissionMode;
  capacity?: string;
  rsvpLimitEnabled?: boolean;
  rsvpLimit?: string;
  rsvpMaxPartySize?: string;
}

/** What the saved row carries for these steps (from GET …/overview). */
export interface SalesSaved {
  category?: string | null;
  rsvpLimit?: number | null;
  rsvpMaxPartySize?: number;
  tiers?: OverviewTier[];
  tax?: EventTax;
  taxInclusive?: boolean;
  /** Why the admission mode cannot change (orders or RSVPs exist), else null. */
  admissionLock?: string | null;
}

// Top-level listing categories organizers pick from on the Name step. Stored
// as plain text on Event.category, so an older free-text value still loads.
export const EVENT_CATEGORIES = [
  'Music',
  'Arts & Theatre',
  'Comedy',
  'Film',
  'Festivals & Fairs',
  'Markets & Vendors',
  'Conventions & Expos',
  'Conferences & Workshops',
  'Sports & Fitness',
  'Food & Drink',
  'Gaming',
  'Community',
  'Charity & Fundraisers',
  'Family & Kids',
  'Nightlife',
  'Other',
] as const;

export const SALES_FIELD_IDS = {
  category: 'setup-category',
  capacity: 'setup-capacity',
  // RsvpSettingsFields owns these ids (shared with the event editor).
  rsvpLimit: 'event-rsvp-limit',
  rsvpMaxPartySize: 'event-rsvp-party-size',
} as const;

const patch = (client: PatchClient, { orgId, eventId }: { orgId: string; eventId: string }, body: Record<string, unknown>) =>
  client.patch(`/organizations/${orgId}/events/${eventId}`, body);

const orNull = (body: Record<string, unknown>) => (Object.keys(body).length ? body : null);

/** Whole number in range, or NaN; blank is null. */
function intField(value: string | undefined, min: number, max: number): number | null {
  const text = (value ?? '').trim();
  if (!text) return null;
  const n = Number(text);
  return Number.isInteger(n) && n >= min && n <= max ? n : NaN;
}

export const modeOf = (ctx: StepCtx): AdmissionMode => ctx.fields.admissionMode ?? ctx.saved?.admissionMode ?? 'TICKETED';

/** The description, when it changed. The editor sends '' when empty; the backend sanitises on write (gotcha 20). */
export function descriptionPatch({ saved, fields }: StepCtx): Record<string, unknown> {
  if (!saved || fields.description === undefined || (fields.description || null) === (saved.description || null)) return {};
  return { description: fields.description || null };
}

export const DESCRIBE_STEP: EventStep = {
  key: 'description', title: 'Describe it', rule: 'S', anchor: 'about', built: true,
  // A registration event's description is on its Name step: one page, asked once.
  visible: (ctx) => (ctx.saved?.type ?? ctx.fields.type ?? 'LIVE') !== 'REGISTRATION',
  complete: (ctx) => !!ctx.saved?.description,
  payload: (ctx) => (ctx.saved ? orNull(descriptionPatch(ctx)) : null),
  save: patch,
};

export const IMAGE_STEP: EventStep = {
  key: 'image', title: 'Add an image', rule: 'S', anchor: 'event-hero-image', built: true,
  visible: () => true,
  complete: (ctx) => !!ctx.saved?.logoUrl,
};

function ticketErrors(ctx: StepCtx): FieldError[] {
  const { fields, saved } = ctx;
  if (modeOf(ctx) === 'TICKETED') {
    const cap = intField(fields.capacity, 1, 100000);
    if (Number.isNaN(cap)) return [{ field: SALES_FIELD_IDS.capacity, message: 'Enter a capacity from 1 to 100,000' }];
    // Only a draft may clear capacity (spec 050 §7.1, 409 CAPACITY_REQUIRED).
    if (cap === null && saved && saved.status !== 'DRAFT' && saved.admissionMode === 'TICKETED' && saved.capacity != null) return [{ field: SALES_FIELD_IDS.capacity, message: 'Enter the capacity: a live event needs one' }];
    return [];
  }
  const errors: FieldError[] = [];
  if (fields.rsvpLimitEnabled) {
    const limit = intField(fields.rsvpLimit, 1, 100000);
    if (limit === null || Number.isNaN(limit)) errors.push({ field: SALES_FIELD_IDS.rsvpLimit, message: 'Enter an RSVP limit from 1 to 100,000' });
  }
  const party = intField(fields.rsvpMaxPartySize, 1, 10);
  if (party === null || Number.isNaN(party)) errors.push({ field: SALES_FIELD_IDS.rsvpMaxPartySize, message: 'Enter guests per RSVP from 1 to 10' });
  return errors;
}

export const TICKETS_STEP: EventStep = {
  key: 'tickets', title: 'Tickets or RSVP', rule: 'R', anchor: 'tickets', built: true,
  visible: () => true,
  // RSVP ≠ Order (gotcha 29): an RSVP event needs no tiers or capacity.
  complete: (ctx) =>
    (ctx.saved?.admissionMode ?? 'TICKETED') === 'RSVP' || (!!ctx.saved?.capacity && (ctx.saved?.tierCount ?? 0) > 0),
  validate: ticketErrors,
  payload: (ctx) => {
    const { saved, fields } = ctx;
    if (!saved || fields.admissionMode === undefined || ticketErrors(ctx).length) return null;
    const mode = modeOf(ctx);
    const body: Record<string, unknown> = {};
    if (mode !== saved.admissionMode) body.admissionMode = mode;
    if (mode === 'TICKETED') {
      const cap = intField(fields.capacity, 1, 100000);
      // An RSVP event's capacity mirrors its RSVP limit; it is not a ticket capacity.
      const savedCap = saved.admissionMode === 'TICKETED' ? saved.capacity ?? null : null;
      if (cap !== savedCap) body.capacity = cap;
    } else {
      const limit = fields.rsvpLimitEnabled ? intField(fields.rsvpLimit, 1, 100000) : null;
      if (limit !== (saved.rsvpLimit ?? null)) body.rsvpLimit = limit;
      const party = intField(fields.rsvpMaxPartySize, 1, 10) ?? 1;
      if (party !== (saved.rsvpMaxPartySize ?? 1)) body.rsvpMaxPartySize = party;
    }
    return orNull(body);
  },
  save: patch,
};

/** Form values for steps 4–6 from the saved row. */
export function salesFieldsFromSaved(saved: {
  description?: string | null; category?: string | null; admissionMode: AdmissionMode; capacity?: number | null;
  rsvpLimit?: number | null; rsvpMaxPartySize?: number;
}): Required<SalesFields> {
  return {
    description: saved.description ?? '',
    category: saved.category ?? '',
    admissionMode: saved.admissionMode,
    capacity: saved.admissionMode === 'TICKETED' && saved.capacity ? String(saved.capacity) : '',
    rsvpLimitEnabled: (saved.rsvpLimit ?? 0) > 0,
    rsvpLimit: saved.rsvpLimit ? String(saved.rsvpLimit) : '',
    rsvpMaxPartySize: String(saved.rsvpMaxPartySize ?? 1),
  };
}
