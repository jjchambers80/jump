'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';

interface Section {
  href: string;
  label: string;
  /** Only show for these roles. Undefined shows the section to every staff role. */
  roles?: string[];
}

const SECTIONS: Section[] = [
  { href: '/admin/settings', label: 'General' },
  { href: '/admin/settings/domains', label: 'Domains' },
  { href: '/admin/settings/users', label: 'Users', roles: ['ADMIN', 'SYSTEM_ADMIN'] },
];

const active = 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300';
const idle = 'text-gray-700 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-800';

/** Left-hand section list shared by every Settings page. */
export default function SettingsNav() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const userRole = (session?.user as any)?.role;
  const visible = SECTIONS.filter((s) => !s.roles || s.roles.includes(userRole));
  return (
    <nav aria-label="Settings sections" className="w-full shrink-0 md:w-56">
      <ul className="space-y-1">
        {visible.map((s) => {
          const isCurrent = s.href === '/admin/settings' ? pathname === s.href : pathname === s.href || pathname.startsWith(`${s.href}/`);
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
