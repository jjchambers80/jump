// Spec 050: the event setup wizard ships dark behind this build-time flag
// until 050-O reaches parity; 050-P flips it on in prod and deletes it.
import { stepForPurpose } from '@/components/event-setup/applicationSteps';
import type { FormPurpose } from '@/lib/applications';

export const EVENT_WIZARD_ENABLED = process.env.NEXT_PUBLIC_EVENT_WIZARD_ENABLED === 'true';

/**
 * "Continue setup" target (spec 050 §4): a DRAFT whose create flow has not
 * finished resumes at its last step. Null when the flag is off, the event is
 * set up, or the payload predates the wizard fields (undefined ≠ null).
 */
export function continueSetupHref(
  event: { id: string; status: string; setupStep?: string | null; setupCompletedAt?: string | null },
  enabled = EVENT_WIZARD_ENABLED
): string | null {
  if (!enabled || event.status !== 'DRAFT' || event.setupCompletedAt !== null) return null;
  const step = event.setupStep ? `?step=${encodeURIComponent(event.setupStep)}` : '';
  return `/admin/events/${encodeURIComponent(event.id)}/setup${step}`;
}

// ── Edit mode (spec 050 §8.4, card 050-O) ──────────────────────────────────

/** `/admin/events/<id>/setup?step=<key>`, plus `&tier=` / `&form=` deep links. */
export function wizardStepHref(eventId: string, step: string, extra: Record<string, string> = {}): string {
  const query = new URLSearchParams({ step, ...extra });
  return `/admin/events/${encodeURIComponent(eventId)}/setup?${query.toString()}`;
}

/** Where each Details section's Edit control opens the wizard. */
export function detailsEditLinks(
  eventId: string,
  forms: { id: string; purpose?: FormPurpose | null; spaceSelection?: string | null }[]
) {
  const at = (step: string, extra?: Record<string, string>) => wizardStepHref(eventId, step, extra);
  const mapForm = forms.some((f) => f.purpose === 'VENDOR' && f.spaceSelection === 'MAP');
  return {
    name: at('name'),
    venue: at('venue'),
    date: at('date'),
    description: at('description'),
    image: at('image'),
    tickets: at('tickets'),
    tier: (tierId: string) => at('tickets', { tier: tierId }),
    addOns: at('collect-more'),
    form: (form: { id: string; purpose?: FormPurpose | null }) => at(stepForPurpose(form.purpose), { form: form.id }),
    newForm: at('vendors'),
    /** The floor-map step exists only while a vendor form picks spaces on a map; else the Map tab. */
    map: mapForm ? at('floor-map') : null,
    listing: at('description'),
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
};

export function legacyEditStep(scope: 'details' | 'sales' | null, hash: string): string {
  return SECTION_STEP[hash.replace(/^#/, '')] ?? (scope === 'sales' ? 'tickets' : 'name');
}
