// Shared pieces for Settings › Users (list) and Users › Add users.
import type { ReactNode } from 'react';
import type { MemberRole, MemberStatus } from '@/services/api';
import SettingsNav from '../SettingsNav';

export const ROLE_LABEL: Record<MemberRole, string> = { ADMIN: 'Admin', ORGANIZER: 'Organizer' };

export const ROLE_HELP: Record<MemberRole, string> = {
  // Defaults: System administration › Roles can change what each role may do.
  ADMIN: 'Full access, including settings, payments, refunds and users.',
  ORGANIZER: "Events, orders, customers and check-in. By default can't change settings, issue refunds or manage users.",
};

const STATUS: Record<MemberStatus, { label: string; className: string }> = {
  ACTIVE: { label: 'Active', className: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' },
  PENDING: { label: 'Pending', className: 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200' },
  INACTIVE: { label: 'Inactive', className: 'bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-slate-300' },
};

export function MemberStatusPill({ status }: { status: MemberStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS[status].className}`}>
      {STATUS[status].label}
    </span>
  );
}

export const cardClass = 'rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-5';
export const primaryBtn =
  'inline-flex min-h-[44px] items-center justify-center rounded-md bg-accent-500 px-4 py-2 text-sm font-semibold text-gray-950 shadow-sm hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-0';
export const secondaryBtn =
  'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-800 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700 sm:min-h-0';

export function errorMessage(err: any, fallback: string) {
  const detail = Array.isArray(err?.details) ? err.details[0]?.message : null;
  return detail || err?.message || fallback;
}

/** Hand-off from Add users to the list ("Invited 2 users"), read once. */
export const FLASH_KEY = 'jump:users-flash';

export function SettingsShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Settings</h1>
      <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">Manage your organization and business information.</p>
      <div className="mt-8 flex min-w-0 flex-col gap-6 md:flex-row md:items-start">
        <SettingsNav />
        {children}
      </div>
    </div>
  );
}
