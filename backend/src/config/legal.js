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
  cardAuthorization: '2026-09-19-draft',
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
 */
export function cardAuthorizationText({ amount, paymentDueDays, organizationName }) {
  const org = organizationName || 'the organizer';
  const days = Number(paymentDueDays || 7);
  return `I authorize ${org} to charge ${money(amount)} to the card I save now, only if my application is approved. If the charge fails I have ${days} day${days === 1 ? '' : 's'} to pay from my application status page or update my card; my spot may be released after that.`;
}

/** The data-collection consent label on the apply form. */
export function applyConsentText({ organizationName }) {
  return `I agree to ${organizationName || 'the organizer'} and Jump collecting and storing the information in this application, as described in the Privacy Policy.`;
}
