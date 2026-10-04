'use client';

// Account sections (spec 040). One element for every width: a scrolling tab
// row on phones, a vertical list beside the content from `lg` — never two
// copies of the nav in the DOM.

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CalendarCheck, ClipboardList, Mail, Receipt, ShieldCheck, Ticket, UserRound, type LucideIcon } from 'lucide-react';
import { useAccount } from './AccountContext';

interface Section {
  key: string;
  label: string;
  icon: LucideIcon;
  /** Settings sections sit under a rule on the sidebar. */
  settings?: boolean;
}

const SECTIONS: Section[] = [
  { key: '', label: 'Tickets', icon: Ticket },
  { key: 'orders', label: 'Orders', icon: Receipt },
  { key: 'rsvps', label: 'RSVPs', icon: CalendarCheck },
  { key: 'applications', label: 'Applications', icon: ClipboardList },
  { key: 'profile', label: 'Profile', icon: UserRound, settings: true },
  { key: 'preferences', label: 'Email preferences', icon: Mail, settings: true },
  { key: 'privacy', label: 'Privacy', icon: ShieldCheck, settings: true },
];

/** Which section a path belongs to; works for the platform and the custom-domain form alike. */
export function sectionOf(pathname: string): string {
  const match = pathname.match(/\/account(?:\/([^/?#]+))?/);
  return match?.[1] ?? '';
}

export default function AccountNav() {
  const { applications, rsvps, href } = useAccount();
  const pathname = usePathname() ?? '';
  const current = sectionOf(pathname);
  // Applications and RSVPs only for buyers who have some; the pages stay reachable.
  const has = { applications: (applications?.length ?? 0) > 0, rsvps: (rsvps?.length ?? 0) > 0 } as Record<string, boolean>;
  const sections = SECTIONS.filter((s) => !(s.key in has) || has[s.key] || current === s.key);
  const firstSetting = sections.findIndex((s) => s.settings);
  const listRef = useRef<HTMLUListElement>(null);

  // Phones: the tab row scrolls sideways; bring the current tab into view (no page scroll).
  useEffect(() => {
    const list = listRef.current;
    const active = list?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!list || !active || list.scrollWidth <= list.clientWidth) return;
    list.scrollLeft = active.offsetLeft - (list.clientWidth - active.offsetWidth) / 2;
  }, [current]);

  return (
    <nav aria-label="Account" data-testid="account-nav" className="-mx-4 lg:mx-0">
      <ul ref={listRef} className="relative flex gap-1 overflow-x-auto border-b border-gray-200 px-4 [scrollbar-width:none] dark:border-slate-700 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:border-b-0 lg:px-0">
        {sections.map(({ key, label, icon: Icon }, index) => {
          const active = current === key;
          return (
            <li
              key={key || 'tickets'}
              className={`shrink-0 ${index === firstSetting ? 'lg:mt-3 lg:border-t lg:border-gray-200 lg:pt-3 dark:lg:border-slate-700' : ''}`}
            >
              <Link
                href={href(key)}
                aria-current={active ? 'page' : undefined}
                className={`group relative flex items-center gap-2.5 whitespace-nowrap px-3 py-3 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-brand lg:rounded-lg lg:py-2.5 ${
                  active
                    ? 'text-gray-900 dark:text-slate-100 lg:bg-white lg:shadow-sm lg:ring-1 lg:ring-gray-200 dark:lg:bg-slate-800 dark:lg:ring-slate-700'
                    : 'text-gray-600 hover:text-gray-900 dark:text-slate-400 dark:hover:text-slate-100 lg:hover:bg-gray-100 dark:lg:hover:bg-slate-800/60'
                }`}
              >
                <Icon
                  aria-hidden
                  className={`h-4 w-4 shrink-0 ${active ? 'text-brand-link' : 'text-gray-400 group-hover:text-gray-600 dark:text-slate-500 dark:group-hover:text-slate-300'}`}
                />
                {label}
                {/* Phones: the active tab sits on a brand underline; from lg the card carries it. */}
                <span
                  aria-hidden
                  className={`absolute inset-x-3 -bottom-px h-0.5 rounded-full lg:hidden ${active ? 'bg-brand' : 'bg-transparent'}`}
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
