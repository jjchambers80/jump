// Admin Sidebar navigation component (T003, T018, T024)
// Links per FR-005 (Dashboard, Orgs, Venues, Events, Analytics, Scan)
// FR-006 (Users — ADMIN only), with Settings pinned to the footer
// Active state via usePathname(), mobile-responsive with toggle

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';

interface NavItem {
  label: string;
  href: string;
  /** Only show for these roles. If undefined, show for all allowed roles. */
  roles?: string[];
}

const navItems: NavItem[] = [
  { label: 'Dashboard', href: '/admin/dashboard' },
  { label: 'Organizations', href: '/admin/organizations' },
  { label: 'Venues', href: '/admin/venues' },
  { label: 'Events', href: '/admin/events' },
  { label: 'Orders', href: '/admin/orders' },
  { label: 'Analytics', href: '/admin/analytics' },
  { label: 'Scan', href: '/admin/scan' },
  { label: 'Users', href: '/admin/users', roles: ['ADMIN'] },
];

interface AdminSidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function AdminSidebar({ isOpen, onClose }: AdminSidebarProps) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const userRole = (session?.user as any)?.role;

  const isActive = (href: string) => {
    if (href === '/admin/dashboard') {
      return pathname === '/admin' || pathname === '/admin/dashboard';
    }
    // Match exact or sub-routes (e.g. /admin/events/new matches /admin/events)
    return pathname === href || pathname.startsWith(href + '/');
  };

  const visibleItems = navItems.filter((item) => !item.roles || item.roles.includes(userRole));

  return (
    <>
      {/* Mobile overlay backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={onClose}
          aria-hidden="true"
          data-testid="sidebar-backdrop"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed top-0 left-0 z-40 h-full w-64 bg-white dark:bg-slate-800
          border-r border-gray-200 dark:border-slate-700
          transform transition-transform duration-200 ease-in-out
          md:relative md:translate-x-0 md:z-auto
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-4 border-b border-gray-200 dark:border-slate-700">
            <Link
              href="/admin/dashboard"
              className="text-lg font-bold text-gray-900 dark:text-white"
              onClick={onClose}
            >
              Admin
            </Link>
            {/* Mobile close button */}
            <button
              onClick={onClose}
              className="md:hidden p-1 text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200"
              aria-label="Close sidebar"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {/* Navigation links */}
          <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
            {visibleItems.map((item) => {
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onClose}
                  className={`
                    flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors
                    ${
                      active
                        ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
                        : 'text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700'
                    }
                  `}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {/* Settings remains pinned and visible when the navigation list scrolls. */}
          <div className="px-3 py-4 border-t border-gray-200 dark:border-slate-700">
            <Link
              href="/admin/settings"
              onClick={onClose}
              className={`flex items-center w-full px-3 py-2 text-sm font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                isActive('/admin/settings')
                  ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
                  : 'text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700'
              }`}
            >
              Settings
            </Link>
          </div>
        </div>
      </aside>
    </>
  );
}
