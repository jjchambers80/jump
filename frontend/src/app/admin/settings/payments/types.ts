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

// ─── Stripe Connect (spec 010 phase 2) ─────────────────────────────────────

export type ConnectStatus = 'not_started' | 'onboarding' | 'restricted' | 'active' | 'disconnected';

export interface ConnectAccount {
  stripeAccountId: string;
  mode: StripeMode;
  status: ConnectStatus;
  chargesEnabled: boolean;
  transfersEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  disabledReason: string | null;
  /** Stripe requirement field names still outstanding (e.g. "external_account"). */
  currentlyDue: string[];
  bank: { name: string | null; last4: string; currency: string | null } | null;
  payouts: {
    interval: 'daily' | 'weekly' | 'monthly' | 'manual' | null;
    /** Weekday name for weekly, day-of-month as a string for monthly. */
    anchor: string | null;
    delayDays: number | null;
    statementDescriptor: string | null;
    lastPayoutAt: string | null;
    lastPayoutFailure: string | null;
  };
  disconnectedAt: string | null;
  lastSyncedAt: string | null;
}

export interface ConnectState {
  /** STRIPE_CONNECT_ENABLED on the backend. False hides every payouts element. */
  enabled: boolean;
  status: ConnectStatus;
  account: ConnectAccount | null;
}

export interface UpdatePayoutSettingsBody {
  interval?: 'daily' | 'weekly' | 'monthly';
  anchor?: string | number | null;
  statementDescriptor?: string;
}

export const CONNECT_DISABLED: ConnectState = { enabled: false, status: 'not_started', account: null };

export interface PaymentSettingsResponse {
  provider: PaymentProviderStatus;
  settings: PaymentSettings;
  /** Absent from older backends; treat as disabled. */
  connect?: ConnectState;
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

export const CONNECT_PILL: Record<ConnectStatus, { label: string; style: string }> = {
  not_started: { label: 'Set up payouts', style: 'bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-slate-300' },
  onboarding: { label: 'Finish setup', style: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' },
  restricted: { label: 'Action required', style: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' },
  active: { label: 'Receiving payouts', style: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' },
  disconnected: { label: 'Disconnected', style: 'bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-slate-300' },
};

/** Button label for the onboarding action per state (null = no onboarding action). */
export const CONNECT_ACTION: Record<ConnectStatus, string | null> = {
  not_started: 'Set up payouts',
  onboarding: 'Continue setup',
  restricted: 'Update details',
  active: null,
  disconnected: 'Reconnect',
};

export const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;

export function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** "Daily", "Weekly on Friday", "Monthly on the 15th". */
export function describeSchedule(payouts: ConnectAccount['payouts']): string {
  const { interval, anchor } = payouts;
  if (!interval) return 'Not set';
  if (interval === 'daily') return 'Every business day';
  if (interval === 'weekly') return anchor ? `Weekly on ${capitalize(anchor)}` : 'Weekly';
  if (interval === 'monthly') return anchor ? `Monthly on the ${ordinal(Number(anchor))}` : 'Monthly';
  return 'Manual';
}

export function ordinal(day: number): string {
  const mod100 = day % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${day}th`;
  switch (day % 10) {
    case 1:
      return `${day}st`;
    case 2:
      return `${day}nd`;
    case 3:
      return `${day}rd`;
    default:
      return `${day}th`;
  }
}

/** Client-side mirror of the payout descriptor rule (22 chars, letters/numbers/spaces, one letter). */
export function payoutDescriptorError(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '') return 'Enter a payout name.';
  if (/[^A-Za-z0-9 ]/.test(trimmed)) return 'Letters, numbers and spaces only.';
  const clean = normalizeDescriptor(trimmed);
  if (!/[A-Z]/.test(clean)) return 'Include at least one letter.';
  if (clean.length > 22) return 'Use 22 characters or fewer.';
  return null;
}

/** Human labels for the Stripe requirement field names shown while restricted. */
export function describeRequirement(field: string): string {
  if (field === 'external_account') return 'Bank account';
  if (field.startsWith('individual.') || field.startsWith('representative.')) return 'Personal details';
  if (field.startsWith('company.')) return 'Business details';
  if (field.startsWith('business_profile.')) return 'Business profile';
  if (field.startsWith('tos_acceptance')) return 'Terms of service';
  return field.replace(/[._]/g, ' ');
}
