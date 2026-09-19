// Jump plan / subscription types and formatting (spec 022 phase 2).

export interface BillingOffer {
  trialDays: number;
  priceId: string;
  unitAmount: number | null;
  currency: string;
  interval: 'day' | 'week' | 'month' | 'year' | string;
  intervalCount: number;
  productName: string | null;
}

export interface PlanStatus {
  enabled: boolean;
  plan: 'FREE' | 'STARTER';
  subscriptionStatus: string | null;
  trialEndsAt: string | null;
  currentPeriodEndsAt: string | null;
  hasSubscription: boolean;
  canManage: boolean;
  offer: BillingOffer | null;
  canEdit?: boolean;
}

export interface CheckoutStart {
  clientSecret: string;
  sessionId: string;
  offer: BillingOffer | null;
}

const INTERVAL_SHORT: Record<string, string> = { day: 'day', week: 'wk', month: 'mo', year: 'yr' };

/** "$39/mo" */
export function formatOfferPrice(offer: BillingOffer | null): string {
  if (!offer || offer.unitAmount == null) return '';
  const amount = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: offer.currency.toUpperCase(),
    minimumFractionDigits: offer.unitAmount % 100 === 0 ? 0 : 2,
  }).format(offer.unitAmount / 100);
  const unit = INTERVAL_SHORT[offer.interval] ?? offer.interval;
  return offer.intervalCount > 1 ? `${amount} every ${offer.intervalCount} ${offer.interval}s` : `${amount}/${unit}`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(iso));
}

/** The date the trial ends if started today. */
export function trialEndDate(trialDays: number, from = new Date()): Date {
  const d = new Date(from);
  d.setDate(d.getDate() + trialDays);
  return d;
}

export const SUBSCRIPTION_LABEL: Record<string, string> = {
  trialing: 'Free trial',
  active: 'Active',
  past_due: 'Payment past due',
  unpaid: 'Unpaid',
  incomplete: 'Payment incomplete',
  incomplete_expired: 'Expired',
  canceled: 'Cancelled',
  paused: 'Paused',
};
