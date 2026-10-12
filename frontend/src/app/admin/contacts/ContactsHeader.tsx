import Link from 'next/link';
import type { ReactNode } from 'react';

const TABS = [
  { key: 'contacts', label: 'Contacts', href: '/admin/contacts' },
  { key: 'forms', label: 'Forms', href: '/admin/contacts/forms' },
] as const;

/** Title, section tabs and the primary action shared by the Contacts list and Forms. */
export default function ContactsHeader({
  active,
  subtitle,
  action,
}: {
  active: (typeof TABS)[number]['key'];
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="mb-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Contacts</h1>
          {subtitle && <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">{subtitle}</p>}
        </div>
        {action}
      </div>
      <nav aria-label="Contacts sections" className="mt-4 border-b border-gray-200 dark:border-slate-700">
        <ul className="-mb-px flex gap-6">
          {TABS.map((tab) => (
            <li key={tab.key}>
              <Link
                href={tab.href}
                aria-current={tab.key === active ? 'page' : undefined}
                className={`inline-flex min-h-[44px] items-center border-b-2 px-1 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600 ${
                  tab.key === active
                    ? 'border-accent-500 text-gray-900 dark:text-white'
                    : 'border-transparent text-gray-600 hover:border-gray-300 hover:text-gray-900 dark:text-slate-400 dark:hover:border-slate-500 dark:hover:text-white'
                }`}
              >
                {tab.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
