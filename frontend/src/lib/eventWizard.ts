// Spec 050: links into the event setup wizard, the one editor for every
// event field (always on since 050-P), and its application flows (spec 051).
import { formEditHref, formFlowHref } from '@/components/event-setup/formFlows';
import type { FormPurpose } from '@/lib/applications';

/**
 * "Continue setup" target (spec 050 §4): a DRAFT whose create flow has not
 * finished resumes at its last step. Null when the event is set up, or the
 * payload predates the wizard fields (undefined ≠ null).
 */
export function continueSetupHref(
  event: { id: string; status: string; setupStep?: string | null; setupCompletedAt?: string | null }
): string | null {
  if (event.status !== 'DRAFT' || event.setupCompletedAt !== null) return null;
  const step = event.setupStep ? `?step=${encodeURIComponent(event.setupStep)}` : '';
  return `/admin/events/${encodeURIComponent(event.id)}/setup${step}`;
}

// ── Edit mode (spec 050 §8.4, card 050-O) ──────────────────────────────────

/** `/admin/events/<id>/setup?step=<key>`, plus `&tier=` / `&form=` deep links. */
export function wizardStepHref(eventId: string, step: string, extra: Record<string, string> = {}): string {
  const query = new URLSearchParams({ step, ...extra });
  return `/admin/events/${encodeURIComponent(eventId)}/setup?${query.toString()}`;
}

/** Adds `org=<id>` to a wizard link, so a member of two orgs opens it in the right one (OrgFromUrlGate). */
export function withOrg(href: string, orgId: string | null | undefined): string {
  if (!orgId || !href.includes('/setup?')) return href;
  return `${href}&org=${encodeURIComponent(orgId)}`;
}

/** Where each Details section's Edit control opens the wizard. */
export function detailsEditLinks(
  eventId: string,
  forms: { id: string; purpose?: FormPurpose | null; spaceSelection?: string | null }[],
  orgId?: string | null
) {
  const at = (step: string, extra?: Record<string, string>) => withOrg(wizardStepHref(eventId, step, extra), orgId);
  const mapForm = forms.find((f) => f.purpose === 'VENDOR' && f.spaceSelection === 'MAP');
  return {
    name: at('name'),
    venue: at('venue'),
    date: at('date'),
    description: at('description'),
    image: at('image'),
    tickets: at('tickets'),
    tier: (tierId: string) => at('tickets', { tier: tierId }),
    addOns: at('collect-more'),
    /** Application forms are set up in their own flows (spec 051), one form per run. */
    form: (form: { id: string; purpose?: FormPurpose | null }) => formEditHref(eventId, form, orgId),
    /** The vendor flow's Floor map step exists only while a vendor form picks spaces on a map; else the Map tab. */
    map: mapForm ? formFlowHref(eventId, 'vendors', { form: mapForm.id, step: 'floor-map', org: orgId }) : null,
    listing: at('description'),
    guests: formFlowHref(eventId, 'special-guests', { step: 'lineup', org: orgId }),
  };
}

/** Old editor section hashes (`/edit#event-…`, `/edit/details`, `/edit/sales`) → wizard step. */
const SECTION_STEP: Record<string, string> = {
  'event-details': 'name',
  'event-name': 'name',
  'event-media': 'image',
  'event-when-where': 'date',
  'event-venue': 'venue',
  'event-date': 'date',
  'event-listing': 'description',
  'event-admission': 'tickets',
  'event-price-tiers': 'tickets',
  'event-add-ons': 'collect-more',
  'event-category': 'description',
  'event-description': 'description',
  'event-slug': 'name',
  'event-image-tile': 'image',
  'event-date-zone': 'date',
  'event-capacity': 'tickets',
  'event-capacity-warning': 'tickets',
  'event-admission-lock': 'tickets',
  'event-tax-summary': 'tickets',
};

export function legacyEditStep(scope: 'details' | 'sales' | null, hash: string): string {
  const id = hash.replace(/^#/, '');
  // RSVP fields (`event-rsvp-limit`, `event-rsvp-party-size`, their hints and errors) live with admission.
  if (id.startsWith('event-rsvp-')) return 'tickets';
  return SECTION_STEP[id] ?? (scope === 'sales' ? 'tickets' : 'name');
}
