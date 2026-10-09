// Shared by the system Organizations list and detail pages.

import type { SystemOrganization } from '@/services/api';

const PILL = 'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap';

/** Status as text in a pill (never colour alone). An unfinished signup wins over ACTIVE. */
export function OrgStatusPill({ org }: { org: Pick<SystemOrganization, 'status' | 'onboardingCompletedAt'> }) {
  if (org.status === 'INACTIVE') {
    return <span className={`${PILL} bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200`}>Suspended</span>;
  }
  if (!org.onboardingCompletedAt) {
    return <span className={`${PILL} bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200`}>Unfinished signup</span>;
  }
  return <span className={`${PILL} bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300`}>Active</span>;
}

const SUBSCRIPTION_SUFFIX: Record<string, string> = { trialing: ' · trial', past_due: ' · past due', canceled: ' · canceled' };

export function planLabel(org: Pick<SystemOrganization, 'plan' | 'subscriptionStatus'>): string {
  if (!org.plan) return 'No plan';
  const name = org.plan === 'STARTER' ? 'Starter' : 'Free';
  return name + (SUBSCRIPTION_SUFFIX[org.subscriptionStatus ?? ''] ?? '');
}

export const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;
