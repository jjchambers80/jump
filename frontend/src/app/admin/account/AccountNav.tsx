'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const SECTIONS = [
  { href: '/admin/account', label: 'General' },
  { href: '/admin/account/security', label: 'Security' },
];

const active = 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300';
const idle = 'text-gray-700 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-800';

/** Left-hand section list for the personal account pages (mirrors SettingsNav). */
export default function AccountNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Account sections" className="w-full shrink-0 md:w-56">
      <ul className="space-y-1">
        {SECTIONS.map((s) => {
          const isCurrent = s.href === '/admin/account' ? pathname === s.href : pathname === s.href || pathname.startsWith(`${s.href}/`);
          return (
            <li key={s.href}>
              <Link
                href={s.href}
                aria-current={isCurrent ? 'page' : undefined}
                className={`block w-full rounded-md px-3 py-2 text-left text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500 ${isCurrent ? active : idle}`}
              >
                {s.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
