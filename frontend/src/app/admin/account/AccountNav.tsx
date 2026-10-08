'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const SECTIONS = [
  { href: '/admin/account', label: 'General' },
  { href: '/admin/account/security', label: 'Security' },
  ...(process.env.NEXT_PUBLIC_AGENT_ACCESS_ENABLED === 'true' ? [{ href: '/admin/account/connected-apps', label: 'Connected apps' }] : []),
];

const active = 'bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300';
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
                className={`block w-full rounded-md px-3 py-2 text-left text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-accent-500 ${isCurrent ? active : idle}`}
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
