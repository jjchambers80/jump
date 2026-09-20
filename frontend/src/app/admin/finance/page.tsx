// Finance — /admin/finance
// Entry point for money that has already been collected: where it is paid out
// (Payouts), how sales tax is collected (Settings › Tax) and how payments are
// configured (Settings › Payments). Orders stays the one list of what was
// sold; nothing here duplicates it.
'use client';

import Link from 'next/link';
import { Landmark, Receipt, Settings2, type LucideIcon } from 'lucide-react';
import { ChevronRightIcon } from '../settings/icons';

interface Section {
  href: string;
  title: string;
  description: string;
  icon: LucideIcon;
  testId: string;
}

const SECTIONS: Section[] = [
  {
    href: '/admin/finance/payouts',
    title: 'Payouts',
    description: 'Balance, upcoming and past transfers of ticket revenue to your bank account.',
    icon: Landmark,
    testId: 'finance-payouts-link',
  },
  {
    href: '/admin/settings/tax',
    title: 'Taxes',
    description: 'Where sales tax is collected and at what rate.',
    icon: Receipt,
    testId: 'finance-taxes-link',
  },
  {
    href: '/admin/settings/payments',
    title: 'Payment settings',
    description: 'Payment methods, statement name, rates and the payout bank account.',
    icon: Settings2,
    testId: 'finance-settings-link',
  },
];

export default function FinancePage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Finance</h1>
      <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">Payouts, taxes and payment settings for your organization.</p>

      <ul className="mt-8 divide-y divide-gray-200 rounded-xl border border-gray-200 bg-white shadow-sm dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-800">
        {SECTIONS.map((section) => {
          const Icon = section.icon;
          return (
            <li key={section.href}>
              <Link
                href={section.href}
                data-testid={section.testId}
                className="flex items-center gap-4 px-4 py-4 text-sm transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:hover:bg-slate-700/40 sm:px-5"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-300">
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-gray-900 dark:text-white">{section.title}</span>
                  <span className="block text-gray-600 dark:text-slate-400">{section.description}</span>
                </span>
                <ChevronRightIcon className="h-4 w-4 shrink-0 text-gray-400 dark:text-slate-500" />
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
