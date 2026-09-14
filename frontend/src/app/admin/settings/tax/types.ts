// Settings › Tax (spec 009) — shapes returned by GET /admin/settings/tax.

export type TaxSource = 'STRIPE' | 'MANUAL';
export type TaxServiceState = 'active' | 'pending' | 'unavailable';

export interface TaxServiceStatus {
  provider: 'STRIPE_TAX';
  status: TaxServiceState;
  registrations: Array<{ country: string; region: string | null }>;
  /** Only present for SYSTEM_ADMIN (link to the platform's Stripe dashboard). */
  manageUrl?: string;
  error: string | null;
}

export interface TaxRegionRow {
  country: string;
  /** Two-letter US state code. */
  region: string;
  name: string;
  venueCount: number;
  /** DRAFT/PUBLISHED events in this state with a future date — what a save recalculates. */
  upcomingEventCount: number;
  /** A TaxRegion row exists; false means "Not set" and no tax is collected. */
  configured: boolean;
  collecting: boolean;
  source: TaxSource | null;
  /** Decimal fraction, e.g. 0.0825. */
  manualRate: number | null;
  /** The platform's Stripe account has an active registration for this state. */
  registrationFound: boolean;
  lastRate: number | null;
  lastSource: TaxSource | null;
  lastCheckedAt: string | null;
  lastError: string | null;
}

export interface TaxSettingsResponse {
  service: TaxServiceStatus;
  regions: TaxRegionRow[];
  needsAddress: Array<{ id: string; name: string }>;
  canEdit: boolean;
}

export interface UpsertTaxRegionBody {
  collecting: boolean;
  source: TaxSource;
  manualRate?: number | null;
}

export interface UpsertTaxRegionResponse {
  region: TaxRegionRow;
  recalculatedEvents: number;
}

export const SERVICE_LABEL: Record<TaxServiceState, string> = {
  active: 'Active',
  pending: 'Pending setup',
  unavailable: 'Unavailable',
};

export const SERVICE_STYLE: Record<TaxServiceState, string> = {
  active: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  unavailable: 'bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-slate-300',
};

/** 0.0825 → "8.25%". Up to three decimals, trailing zeros trimmed. */
export function formatRate(rate: number | null | undefined): string {
  if (rate == null || Number.isNaN(rate)) return '—';
  const pct = rate * 100;
  const text = pct.toFixed(3).replace(/\.?0+$/, '');
  return `${text}%`;
}

/** "8.25" (percent as typed) → 0.0825; null when not a number. */
export function parsePercent(input: string): number | null {
  const trimmed = input.trim().replace(/%$/, '');
  if (trimmed === '') return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 1000) / 100000;
}
