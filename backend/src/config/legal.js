// Legal document versions and the consent texts the product shows (spec 023,
// built by spec 024 phase 3). The pages themselves are spec 023 phase 1 and
// stay dark; until counsel's text ships every version is a `-draft` and the
// checkbox labels below are engineering copy.
//
// Bumping a version here is what makes an old acceptance stale: clients read
// GET /legal/versions, echo the versions they showed in `acceptances`, and
// the backend refuses (400 LEGAL_VERSION_STALE) anything that is not current.

export const LEGAL_VERSIONS = Object.freeze({
  terms: '2026-09-19-draft',
  privacy: '2026-09-19-draft',
  // Bumped for the map-bound split below (EVE-29). That correction changes
  // what the sentence *means* for a booth applicant — from "your card is
  // charged on approval" to "you come back and pay when you pick a booth" —
  // so a new acceptance must not be indistinguishable in the trail from an
  // old one. Still `-draft`: the pages are dark and publishing them is a
  // separate decision.
  cardAuthorization: '2026-09-25-draft',
});

/** `LegalDocument` enum value for each version key. */
export const DOCUMENT_FOR_KEY = Object.freeze({
  terms: 'TERMS',
  privacy: 'PRIVACY',
  cardAuthorization: 'CARD_AUTHORIZATION',
});

/** Version key for each `LegalDocument` this config knows. */
export const KEY_FOR_DOCUMENT = Object.freeze({
  TERMS: 'terms',
  PRIVACY: 'privacy',
  CARD_AUTHORIZATION: 'cardAuthorization',
});

/**
 * Whether ticket checkout must carry acceptances. Off until the legal pages
 * go live (spec 023 phase 1): the checkout page always sends them, but a
 * client that does not is logged rather than refused. The apply form always
 * requires them — its checkboxes exist today.
 */
export function checkoutAcceptanceRequired() {
  return process.env.LEGAL_ACCEPTANCE_REQUIRED === 'true';
}

const money = (n) => `$${Number(n || 0).toFixed(2)}`;

/**
 * The card-on-file authorization label for a PAID form that charges at
 * approval — rebuilt server-side from the same inputs the client used so the
 * stored `presentedText` is what was shown, never client-supplied.
 *
 * Two variants, selected by `mapBound`, because the two flows do different
 * things with the saved card:
 *
 * - **not map-bound** — approval charges the card on file directly
 *   (`ApplicationService` sets `PROCESSING` and charges).
 * - **map-bound (booth)** — approval is an invitation to pick inventory. It
 *   sets `PAYMENT_DUE` and the money moves later, through a hosted Stripe
 *   Checkout session, once the vendor holds a specific booth (`payNow`).
 *
 * A map-bound tier is forced to `chargeTiming: APPROVAL`, and `APPROVAL` is
 * exactly what makes this authorization mandatory — so *every* booth
 * applicant sees this label. Getting the variant wrong stores a consent
 * record describing a charge mechanism the code never uses.
 */
export function cardAuthorizationText({ amount, paymentDueDays, organizationName, mapBound = false }) {
  const org = organizationName || 'the organizer';
  const days = Number(paymentDueDays || 7);
  const window = `${days} day${days === 1 ? '' : 's'}`;
  if (mapBound)
    return `I save my card now so ${org} can hold my place. Nothing is charged unless my application is approved — if it is, I come back to pick my booth and pay ${money(amount)} then. I have ${window} to do that; my spot may be released to someone else after that.`;
  return `I authorize ${org} to charge ${money(amount)} to the card I save now, only if my application is approved. If the charge fails I have ${window} to pay from my application status page or update my card; my spot may be released to someone else after that.`;
}

/**
 * The data-collection consent label on the apply form.
 *
 * The second sentence is the one thing an applicant cannot discover from the
 * label alone: `Application.publicProfile` defaults to on and the listing
 * goes live on approval.
 *
 * The platform name is still hardcoded "Jump" — naming the contracting party
 * is an open question (OQ-A3 on EVE-17) and is not this change's to answer.
 */
export function applyConsentText({ organizationName }) {
  const org = organizationName || 'the organizer';
  return `I agree to ${org} and Jump collecting and storing the information in this application, as described in the Privacy Policy. If my application is approved, my business name, description, website, socials and first photo will be shown on the event's public page.`;
}

/**
 * Shown above the submit button on every application form, paid or free.
 * Capacity is consumed by the APPROVE transition, never by submission, and
 * `WAITLISTED` is a real place to land — "decides who gets a spot" covers it
 * without enumerating states.
 *
 * Rendered client-side only; no acceptance is recorded for it. It lives here
 * so the wording has one authoritative home alongside its siblings and the
 * frontend mirror can be diffed against it.
 */
export function applicationNotBookingText({ organizationName }) {
  return `Submitting an application is not a booking. ${organizationName || 'The organizer'} reviews applications and decides who gets a spot.`;
}

/**
 * Refund clause on a paid application form. Deliberately the weakest of
 * counsel's three variants: there is no automatic vendor refund path, so a
 * rejected or withdrawn applicant's money comes back only by staff action.
 * This sentence promises nothing else. Display-only, like the one above.
 */
export function applicationRefundText({ organizationName }) {
  return `Refunds are up to ${organizationName || 'the organizer'}. Ask them about their terms before you submit.`;
}
