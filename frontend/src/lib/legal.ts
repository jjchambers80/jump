// Legal versions and consent texts (spec 023 via spec 024 phase 3). A form
// that records consent fetches the current versions once, shows the texts
// below, and echoes the versions in `acceptances` so the backend can refuse
// a stale one (400 LEGAL_VERSION_STALE → reload and try again).

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';

export interface LegalVersions {
  terms: string;
  privacy: string;
  cardAuthorization: string;
}

export type LegalDocument = 'TERMS' | 'PRIVACY' | 'CARD_AUTHORIZATION';

export interface LegalAcceptanceInput {
  document: LegalDocument;
  version: string;
}

/** Whether the legal pages exist yet (spec 023 phase 1); links render only then. */
export const LEGAL_PAGES_ENABLED = process.env.NEXT_PUBLIC_LEGAL_PAGES_ENABLED === 'true';
export const LEGAL_PATHS = { terms: '/legal/terms', privacy: '/legal/privacy' } as const;

let cached: Promise<LegalVersions> | null = null;

/** The current document versions, fetched once per page load. */
export function fetchLegalVersions(): Promise<LegalVersions> {
  if (!cached) {
    cached = fetch(`${API_URL}/legal/versions`, { cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error('Could not load legal versions');
        return res.json() as Promise<LegalVersions>;
      })
      .catch((error) => {
        cached = null;
        throw error;
      });
  }
  return cached;
}

/** `acceptances` for a request: terms + privacy, plus the card authorization when the form takes a card for a later charge. */
export function acceptancesFor(versions: LegalVersions, { cardAuthorization = false }: { cardAuthorization?: boolean } = {}): LegalAcceptanceInput[] {
  return [
    { document: 'TERMS', version: versions.terms },
    { document: 'PRIVACY', version: versions.privacy },
    ...(cardAuthorization ? [{ document: 'CARD_AUTHORIZATION' as const, version: versions.cardAuthorization }] : []),
  ];
}

const money = (n: number) => `$${Number(n || 0).toFixed(2)}`;

/**
 * Mirrors backend `config/legal.js` `cardAuthorizationText` — the backend stores its own rendering, never this one.
 *
 * `mapBound` picks the variant: a booth tier's approval does not charge the
 * saved card, it opens the booth picker and the vendor pays on Stripe once
 * they hold a spot. Showing the non-map-bound sentence there would describe
 * a charge that never happens — and that sentence is what gets stored.
 */
export function cardAuthorizationText({ amount, paymentDueDays, organizationName, mapBound = false }: { amount: number; paymentDueDays?: number | null; organizationName?: string | null; mapBound?: boolean }): string {
  const org = organizationName || 'the organizer';
  const days = Number(paymentDueDays || 7);
  const window = `${days} day${days === 1 ? '' : 's'}`;
  if (mapBound)
    return `I save my card now so ${org} can hold my place. Nothing is charged unless my application is approved — if it is, I come back to pick my booth and pay ${money(amount)} then. I have ${window} to do that; my spot may be released to someone else after that.`;
  return `I authorize ${org} to charge ${money(amount)} to the card I save now, only if my application is approved. If the charge fails I have ${window} to pay from my application status page or update my card; my spot may be released to someone else after that.`;
}

/** Mirrors backend `applyConsentText`. */
export function applyConsentText(organizationName?: string | null): string {
  const org = organizationName || 'the organizer';
  return `I agree to ${org} and Jump collecting and storing the information in this application, as described in the Privacy Policy. If my application is approved, my business name, description, website, socials and first photo will be shown on the event's public page.`;
}

/** Mirrors backend `applicationNotBookingText` — above the submit button, paid or free. */
export function applicationNotBookingText(organizationName?: string | null): string {
  return `Submitting an application is not a booking. ${organizationName || 'The organizer'} reviews applications and decides who gets a spot.`;
}

/** Mirrors backend `applicationRefundText` — under the line above, on paid forms. */
export function applicationRefundText(organizationName?: string | null): string {
  return `Refunds are up to ${organizationName || 'the organizer'}. Ask them about their terms before you submit.`;
}
