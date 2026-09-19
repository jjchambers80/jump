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

/** Mirrors backend `config/legal.js` `cardAuthorizationText` — the backend stores its own rendering, never this one. */
export function cardAuthorizationText({ amount, paymentDueDays, organizationName }: { amount: number; paymentDueDays?: number | null; organizationName?: string | null }): string {
  const org = organizationName || 'the organizer';
  const days = Number(paymentDueDays || 7);
  return `I authorize ${org} to charge ${money(amount)} to the card I save now, only if my application is approved. If the charge fails I have ${days} day${days === 1 ? '' : 's'} to pay from my application status page or update my card; my spot may be released after that.`;
}

/** Mirrors backend `applyConsentText`. */
export function applyConsentText(organizationName?: string | null): string {
  return `I agree to ${organizationName || 'the organizer'} and Jump collecting and storing the information in this application, as described in the Privacy Policy.`;
}
