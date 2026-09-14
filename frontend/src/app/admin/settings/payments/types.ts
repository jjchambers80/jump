// Settings › Payments (spec 010) — shapes returned by GET /admin/settings/payments.

export type StripeMode = 'live' | 'test';
export type ChargesState = 'active' | 'unavailable';

export interface PaymentProviderStatus {
  provider: 'STRIPE';
  mode: StripeMode;
  charges: ChargesState;
  /** Platform account prefix, e.g. "JUMP"; null when not set in Stripe. */
  statementDescriptorPrefix: string | null;
  /** Stripe capability status per optional method type ('active' | 'inactive' | 'pending' | null). */
  capabilities: Record<string, string | null>;
  /** Only present for SYSTEM_ADMIN (platform Stripe dashboard). */
  manageUrl?: string;
  /** Only present for SYSTEM_ADMIN (Radar rules). */
  radarUrl?: string;
  error: string | null;
}

export interface PaymentMethodRow {
  type: string;
  label: string;
  group: 'wallets' | 'more';
  help: string;
  /** The platform Stripe account has the capability active. */
  available: boolean;
  enabled: boolean;
}

export interface PaymentSettings {
  organization: { name: string; phoneCountryCode: string | null; phoneNumber: string | null };
  /** Stored value; null means the descriptor is derived from the organization name. */
  statementDescriptorSuffix: string | null;
  descriptor: {
    prefix: string | null;
    suffix: string | null;
    /** "PREFIX* SUFFIX" as the buyer sees it; null when nothing can be sent. */
    full: string | null;
    derived: boolean;
    /** Characters available for the suffix. */
    budget: number;
  };
  enabledPaymentMethods: string[];
  methods: {
    cards: string[];
    wallets: string[];
    optional: PaymentMethodRow[];
  };
  rates: { platformFeePercent: number; processingFeePercent: number; processingFeeFixed: number };
  updatedAt: string | null;
}

export interface PaymentSettingsResponse {
  provider: PaymentProviderStatus;
  settings: PaymentSettings;
  canEdit: boolean;
}

export interface UpdatePaymentSettingsBody {
  statementDescriptorSuffix?: string | null;
  enabledPaymentMethods?: string[];
}

export const CHARGES_LABEL: Record<ChargesState, string> = {
  active: 'Accepting payments',
  unavailable: 'Unavailable',
};

export const CHARGES_STYLE: Record<ChargesState, string> = {
  active: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  unavailable: 'bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-slate-300',
};

export const CARD_BRAND_LABEL: Record<string, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'American Express',
  discover: 'Discover',
  diners: 'Diners Club',
  jcb: 'JCB',
  apple_pay: 'Apple Pay',
  google_pay: 'Google Pay',
};

/** Client-side mirror of the server rule so the dialog can preview and block early. */
export function descriptorError(value: string, budget: number, prefix: string | null): string | null {
  if (!prefix) return 'The platform Stripe account has no statement descriptor prefix yet.';
  const trimmed = value.trim();
  if (trimmed === '') return null; // empty = derived from the organization name
  if (/[^A-Za-z0-9 ]/.test(trimmed)) return 'Letters, numbers and spaces only.';
  const clean = trimmed.toUpperCase().replace(/\s+/g, ' ');
  if (!/[A-Z]/.test(clean)) return 'Include at least one letter.';
  if (clean.length > budget) return `Use ${budget} characters or fewer.`;
  return null;
}

export function normalizeDescriptor(value: string): string {
  return value.toUpperCase().replace(/\s+/g, ' ').trim();
}

export function formatPercent(fraction: number): string {
  return `${(fraction * 100).toFixed(1).replace(/\.0$/, '')}%`;
}
