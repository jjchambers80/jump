// Event readiness (spec 050 §7.2): what stops an event from publishing
// (blockers) and what the organizer should look at first (warnings). This is
// the only implementation: GET …/readiness returns it and publishEvent refuses
// with its blockers. `evaluate` is pure so every code is unit-testable;
// `check` loads the facts it needs. Never calls Stripe.

import { prisma } from '@jump/db';
import { NotFoundError } from '../middleware/errorHandler.js';
import { paymentsEnabled } from './ApplicationFormService.js';
import connectService from './ConnectService.js';
import taxService from './TaxService.js';

// Spec 050-B adds ApplicationForm.purpose; until then every event form is a vendor form.
const FORM_STEP = { VENDOR: 'vendors', SPECIAL_GUEST: 'special-guests', VOLUNTEER: 'volunteers' };
export const stepForForm = (form) => (form.purpose ? FORM_STEP[form.purpose] || 'other-applications' : 'vendors');

const item = (code, step, message, extra) => ({ code, step, message, ...extra });
const isBlank = (html) => !String(html || '').replace(/<[^>]*>|&nbsp;/g, '').trim();

/**
 * @param {object} event  Event with venue, priceTiers, applicationForms (tiers,
 *   _count.questions) and floorMap.
 * @param {object} ctx  { now, paymentsEnabled, paymentsUnavailable, taxError }
 * @returns {{ ready: boolean, blockers: object[], warnings: object[] }}
 */
export function evaluate(event, { now = new Date(), paymentsEnabled: gateOn = false, paymentsUnavailable = false, taxError = null } = {}) {
  const blockers = [];
  const warnings = [];

  if (!String(event.name || '').trim()) blockers.push(item('NAME_MISSING', 'name', 'Give the event a name.'));
  if (!event.venue) blockers.push(item('VENUE_MISSING', 'venue', 'Choose a venue.'));
  if (new Date(event.date) <= now) blockers.push(item('DATE_IN_PAST', 'date', 'The start date is in the past. Pick a future date.'));
  if (event.endDate && new Date(event.endDate) <= new Date(event.date)) {
    blockers.push(item('END_BEFORE_START', 'date', 'The end time must be after the start time.'));
  }

  const tiers = event.priceTiers || [];
  // Gotcha 29: branch on admissionMode. RSVP events have no tiers or capacity.
  if (event.admissionMode === 'TICKETED') {
    if (event.capacity == null) blockers.push(item('CAPACITY_MISSING', 'tickets', 'Set the event capacity.'));
    if (!tiers.some((t) => t.isActive)) blockers.push(item('NO_ACTIVE_TIER', 'tickets', 'Add at least one active ticket tier.'));
    const total = tiers.reduce((sum, t) => sum + t.quantityTotal, 0);
    if (event.capacity != null && total > event.capacity) {
      blockers.push(item('TIERS_EXCEED_CAPACITY', 'tickets', `Ticket tiers add up to ${total}, more than the capacity of ${event.capacity}.`));
    }
    if (paymentsUnavailable && tiers.some((t) => t.isActive && Number(t.price) > 0)) {
      blockers.push(item('PAYMENTS_UNAVAILABLE', 'review', 'Payments are not set up for this organization yet, so paid tickets cannot sell.'));
    }
  }

  if (isBlank(event.description)) warnings.push(item('NO_DESCRIPTION', 'description', 'Add a description so buyers know what to expect.'));
  if (!event.logoUrl && !event.imageId) warnings.push(item('NO_IMAGE', 'image', 'Add an event image.'));

  const forms = (event.applicationForms || []).filter((f) => f.status !== 'CLOSED');
  for (const form of forms) {
    const step = stepForForm(form);
    if (form.kind === 'PAID' && !gateOn) {
      warnings.push(item('PAID_FORMS_DISABLED', step, `${form.name} charges applicants, and paid applications are not available yet. It stays closed.`, { formId: form.id }));
    }
    if (!form._count?.questions) {
      warnings.push(item('FORM_HAS_NO_QUESTIONS', step, `${form.name} has no questions.`, { formId: form.id }));
    }
  }
  if (forms.some((f) => f.kind === 'PAID' && f.spaceSelection === 'MAP') && event.floorMap?.status !== 'PUBLISHED') {
    warnings.push(item('MAP_FORM_WITHOUT_PUBLISHED_MAP', 'floor-map', 'Vendors choose spots on the floor map, but the map is not published.'));
  }
  if (taxError) warnings.push(item('TAX_RATE_UNRESOLVED', 'review', `Sales tax could not be looked up: ${taxError}`));

  return { ready: blockers.length === 0, blockers, warnings };
}

/** True when the event takes money: a paid ticket tier or a PAID application form. */
const takesMoney = (event) =>
  (event.admissionMode === 'TICKETED' && (event.priceTiers || []).some((t) => t.isActive && Number(t.price) > 0)) ||
  (event.applicationForms || []).some((f) => f.kind === 'PAID' && f.status !== 'CLOSED');

class EventReadinessService {
  async check(orgId, eventId) {
    const event = await prisma.event.findFirst({
      where: { id: eventId, venue: { organizationId: orgId } },
      include: {
        venue: true,
        priceTiers: true,
        floorMap: { select: { status: true } },
        applicationForms: { include: { _count: { select: { questions: { where: { archivedAt: null } } } } } },
      },
    });
    if (!event) throw new NotFoundError('Event not found');

    const money = takesMoney(event);
    return evaluate(event, {
      paymentsEnabled: paymentsEnabled(),
      paymentsUnavailable: money && (await this._paymentsUnavailable(orgId)),
      taxError: money ? await this._taxError(orgId, event.venue) : null,
    });
  }

  async _paymentsUnavailable(orgId) {
    try {
      await connectService.chargeAccountFor(orgId);
      return false;
    } catch (error) {
      if (error.code === 'PAYMENTS_UNAVAILABLE') return true;
      throw error;
    }
  }

  /** Gotcha 12: the region row records the last Stripe Tax failure; read it, never call Stripe here. */
  async _taxError(orgId, venue) {
    const key = taxService.resolveRegionForVenue(venue);
    if (!key) return null;
    const row = await prisma.taxRegion.findUnique({
      where: { organizationId_country_region: { organizationId: orgId, ...key } },
      select: { collecting: true, source: true, lastError: true },
    });
    return row?.collecting && row.source === 'STRIPE' ? row.lastError || null : null;
  }
}

export default new EventReadinessService();
