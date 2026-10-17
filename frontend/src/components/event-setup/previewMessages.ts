// Wizard ↔ preview frame messages (spec 050 §8.3). Same origin only, checked
// both ways: the frame answers only its parent, the wizard only its iframe.
// The wizard sends the overlay of unsaved values; the frame loads the saved
// event itself (GET …/preview-payload) and lays the overlay on top.

import type { EventPageEvent, EventVenue } from '@/app/events/[eventId]/eventPage';
import type { AdminForm, ApplicantApplication, PublicForm } from '@/lib/applications';

export const PREVIEW_MESSAGE = 'jump:event-preview';
export const PREVIEW_READY = 'jump:event-preview-ready';

/** Unsaved form values the preview shows before they reach the server. */
export interface PreviewOverlay {
  name?: string;
  date?: string | null;
  endDate?: string | null;
  venue?: EventVenue | null;
  /** Step 6: unsaved admission mode (an RSVP preview shows the RSVP pass, not tiers). */
  admissionMode?: 'TICKETED' | 'RSVP';
  /** Spec 057, step 1 before the row exists: a registration event previews its Register section. */
  type?: 'LIVE' | 'REGISTRATION';
}

export interface PreviewMessage {
  type: typeof PREVIEW_MESSAGE;
  orgId: string;
  /** Null before step 3 creates the row: the frame builds the event from the overlay. */
  eventId: string | null;
  overlay: PreviewOverlay;
  /** Bumped after each save: the frame reloads the saved event. */
  revision: number;
  /** Element id to scroll to; the frame falls back to #event-hero. */
  anchor: string;
  /**
   * Spec 051 application flows: the form being built, as applicants will see
   * it. Present = the frame shows the application form instead of the event page.
   */
  form?: PublicForm | null;
  /**
   * With `form`: `space` shows what an approved vendor sees when they choose
   * a space and pay (Options and pricing), instead of the apply form.
   */
  view?: 'form' | 'space';
}

/** What Start knows before the form exists: its preview is the form's frame with no questions yet. */
export interface DraftForm {
  name: string;
  kind: PublicForm['kind'];
}

export function draftPreviewForm(draft: DraftForm, organizationName?: string | null): PublicForm {
  return {
    id: 'draft',
    kind: draft.kind,
    name: draft.name.trim() || 'Untitled application',
    slug: 'draft',
    intro: null,
    acceptance: { open: true, reason: null },
    chargeTiming: null,
    feeMode: null,
    organizationName: organizationName ?? null,
    tiers: [],
    questions: [],
    // A new form asks for an email only (createForm); the rest is added on the Fields step.
    collectBusiness: false,
    businessFields: [],
    collectName: false,
  };
}

/**
 * The form being built, as the public apply page would get it (spec 051): the
 * saved form, with the unsaved name and intro typed on Form details on top.
 * Always shown as open, whatever its status or dates.
 */
export function previewForm(form: AdminForm, overlay: { name?: string; intro?: string | null; buttonLabel?: string | null } = {}, organizationName?: string | null): PublicForm {
  return {
    id: form.id,
    kind: form.kind,
    name: overlay.name?.trim() || form.name,
    buttonLabel: overlay.buttonLabel !== undefined ? overlay.buttonLabel : form.buttonLabel ?? null,
    slug: form.slug,
    intro: overlay.intro !== undefined ? overlay.intro || null : form.intro,
    acceptance: { open: true, reason: null },
    chargeTiming: form.chargeTiming,
    feeMode: form.feeMode,
    paymentDueDays: form.paymentDueDays,
    organizationName: organizationName ?? null,
    tiers: form.tiers.map((t) => ({ id: t.id, name: t.name, description: t.description, price: t.price, applicantPays: t.price, feesIncluded: 0, tax: 0, soldOut: false, addOns: [] })),
    questions: form.questions,
    collectBusiness: form.collectBusiness,
    businessFields: form.businessFields,
    collectName: form.collectName,
    timezone: form.timezone,
  };
}

/**
 * The vendor's choose-and-pay screen for a form being built (spec 056): an
 * approved application on a TIERS form that lets the vendor pick, with the
 * form's options as the space types. Nothing here is held or charged.
 */
export function spacePreviewApplication(form: PublicForm, event: { id: string; name: string; date: string | null; timezone?: string | null }): ApplicantApplication {
  return {
    id: 'preview',
    orderRef: null,
    form: { id: form.id, name: form.name, kind: form.kind },
    event: { id: event.id, name: event.name, date: event.date ?? '', timezone: event.timezone ?? null },
    organization: null,
    status: 'APPROVED',
    paymentStatus: 'AWAITING_SELECTION',
    tier: null,
    addOns: [],
    amounts: { subtotal: 0, platformFee: 0, processingFee: 0, tax: 0, applicantPays: 0, orgReceives: 0, feeMode: form.feeMode ?? 'PASS', currency: 'usd' },
    paymentDueAt: null,
    submittedAt: null,
    decidedAt: null,
    paidAt: null,
    refundedTotal: 0,
    canWithdraw: false,
    canResume: false,
    canPay: false,
    canUpdateCard: false,
    profile: null,
    answers: [],
    boothLabel: null,
    selection: {
      mode: 'TIERS',
      tierLocked: false,
      categories: form.tiers.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        price: t.price,
        listedPrice: t.price,
        applicantPays: t.applicantPays,
        feesIncluded: t.feesIncluded,
        tax: t.tax,
        spacesLeft: t.soldOut ? 0 : 1,
        guaranteed: false,
        addOns: t.addOns,
      })),
      state: 'CHOOSE',
      heldUntil: null,
      dueAt: null,
      reserveOnApproval: false,
      category: null,
      addOns: [],
      map: { available: false, mapId: null, boothsAvailable: 0 },
      placedBooth: null,
      savedCard: null,
      pricing: { feeMode: form.feeMode ?? 'PASS', taxable: false, taxRate: 0, taxInclusive: false },
    },
  };
}

const ID = /^[\w-]{1,64}$/;
const ANCHOR = /^[\w-]{1,64}$/;
const optionalString = (value: unknown) => value === undefined || value === null || typeof value === 'string';

/** The full shape, checked at the boundary: the ids go into an API path. */
export function isPreviewMessage(data: unknown): data is PreviewMessage {
  if (!data || typeof data !== 'object') return false;
  const m = data as Record<string, unknown>;
  if (m.type !== PREVIEW_MESSAGE || typeof m.orgId !== 'string' || !ID.test(m.orgId)) return false;
  if (m.eventId !== null && (typeof m.eventId !== 'string' || !ID.test(m.eventId))) return false;
  if (typeof m.revision !== 'number' || !Number.isFinite(m.revision)) return false;
  if (typeof m.anchor !== 'string' || !ANCHOR.test(m.anchor)) return false;
  const o = m.overlay as Record<string, unknown> | null;
  if (!o || typeof o !== 'object') return false;
  if (!optionalString(o.name) || !optionalString(o.date) || !optionalString(o.endDate)) return false;
  if (o.admissionMode !== undefined && o.admissionMode !== 'TICKETED' && o.admissionMode !== 'RSVP') return false;
  if (o.type !== undefined && o.type !== 'LIVE' && o.type !== 'REGISTRATION') return false;
  const venue = o.venue as Record<string, unknown> | null | undefined;
  if (venue !== undefined && venue !== null && (typeof venue !== 'object' || typeof venue.id !== 'string' || typeof venue.name !== 'string')) return false;
  const form = m.form as Record<string, unknown> | null | undefined;
  if (form !== undefined && form !== null && (typeof form !== 'object' || typeof form.name !== 'string' || !Array.isArray(form.questions) || !Array.isArray(form.tiers))) return false;
  if (m.view !== undefined && m.view !== 'form' && m.view !== 'space') return false;
  return true;
}

/** Only messages from this origin and the expected window count. */
export const trustedMessage = (event: MessageEvent, source: MessageEventSource | null | undefined) =>
  event.origin === window.location.origin && !!source && event.source === source;

/** Id of the blank event before the row exists; nothing public can be fetched for it. */
export const BLANK_PREVIEW_ID = 'preview';

/** The event before the row exists: blank, so the view shows its placeholders. */
export function blankPreviewEvent(): EventPageEvent {
  return {
    id: BLANK_PREVIEW_ID,
    name: '',
    description: null,
    logoUrl: null,
    date: null,
    endDate: null,
    capacity: null,
    status: 'DRAFT',
    admissionMode: 'TICKETED',
    taxRate: 0,
    venue: null,
    priceTiers: [],
    previewForms: [],
  };
}

/** Saved event + overlay; keys the overlay leaves out keep the saved value. */
export function applyOverlay(base: EventPageEvent, overlay: PreviewOverlay): EventPageEvent {
  const defined = Object.fromEntries(Object.entries(overlay).filter(([, value]) => value !== undefined));
  return { ...base, ...defined };
}
