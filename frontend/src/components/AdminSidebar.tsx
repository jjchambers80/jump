// Admin Sidebar navigation component (T003, T018, T024)
// Links per FR-005 (Dashboard, Venues, Events, Analytics), with Settings
// pinned to the footer. "Online store" edits the active organization's public
// storefront (name, handle, theme, branding); the org itself is picked in the
// header switcher. Users (FR-006, ADMIN only) lives under
// Settings › Users rather than in the main list.
// Sections with sub-pages (Finance, Online store, Content) are collapsed by
// default; a chevron toggle expands them, and the section holding the current
// page opens automatically so the active link is never hidden.
// Active state via usePathname(), mobile-responsive with toggle. On desktop the
// toggle beside Settings collapses the rail to icons only (face symbol in place
// of the logo); the choice is remembered per browser.

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  CalendarDays,
  ChartColumn,
  ChevronRight,
  FileText,
  Landmark,
  LayoutDashboard,
  Map,
  PanelLeftClose,
  PanelLeftOpen,
  MapPin,
  ScanLine,
  Settings,
  ShoppingCart,
  Store,
  Users,
  type LucideIcon,
} from 'lucide-react';
import EventimusLogo from './EventimusLogo';

interface NavItem {
  label: string;
  href: string;
  /** Parent-level items carry an icon; nested links are indented instead. */
  icon?: LucideIcon;
  /** Sub-pages rendered beneath this link when the section is expanded. */
  children?: NavItem[];
  /** Only show for these roles. If undefined, show for all allowed roles. */
  roles?: string[];
}

const navItems: NavItem[] = [
  { label: 'Dashboard', href: '/admin/dashboard', icon: LayoutDashboard },
  // Spec 037 D1: tier presets, application templates and the org-wide
  // submissions list live inside each event now, not in the main nav.
  { label: 'Events', href: '/admin/events', icon: CalendarDays },
  { label: 'Venues', href: '/admin/venues', icon: MapPin },
  { label: 'Maps', href: '/admin/maps', icon: Map },
  { label: 'Orders', href: '/admin/orders', icon: ShoppingCart },
  { label: 'Customers', href: '/admin/customers', icon: Users },
  { label: 'Check In', href: '/admin/orders/scan', icon: ScanLine },
  { label: 'Analytics', href: '/admin/analytics', icon: ChartColumn },
  {
    label: 'Finance',
    href: '/admin/finance',
    icon: Landmark,
    children: [{ label: 'Payouts', href: '/admin/finance/payouts' }],
  },
  {
    label: 'Online store',
    href: '/admin/online-store',
    icon: Store,
    children: [
      { label: 'Pages', href: '/admin/online-store/pages' },
      { label: 'Preferences', href: '/admin/online-store/preferences' },
    ],
  },
  {
    label: 'Content',
    href: '/admin/content',
    icon: FileText,
    children: [
      { label: 'Files', href: '/admin/content/files' },
      { label: 'Forms', href: '/admin/content/forms' },
      { label: 'Galleries', href: '/admin/content/galleries' },
      { label: 'Menus', href: '/admin/content/menus' },
      { label: 'Blog posts', href: '/admin/content/blog-posts' },
    ],
  },
];

/** Every link, parents and children alike, for the "more specific route" check. */
const allItems: NavItem[] = navItems.flatMap((item) => [item, ...(item.children ?? [])]);

/** The section whose href is a prefix of the current path, if any. */
function sectionFor(pathname: string): string | undefined {
  return navItems.find(
    (item) => item.children && (pathname === item.href || pathname.startsWith(item.href + '/'))
  )?.href;
}

const linkClass = (active: boolean) =>
  `flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors ${
    active
      ? 'bg-accent-50 dark:bg-accent-900/30 text-accent-700 dark:text-accent-300'
      : 'text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700'
  }`;

const COLLAPSED_KEY = 'jump.adminSidebarCollapsed';

interface AdminSidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function AdminSidebar({ isOpen, onClose }: AdminSidebarProps) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const userRole = (session?.user as any)?.role;

  // Sections are collapsed until toggled; the one holding the current page is
  // opened whenever the route changes into it.
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    const current = sectionFor(pathname);
    return current ? { [current]: true } : {};
  });
  useEffect(() => {
    const current = sectionFor(pathname);
    if (current) setExpanded((prev) => (prev[current] ? prev : { ...prev, [current]: true }));
  }, [pathname]);

  // Desktop-only: the mobile drawer always opens full width.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSED_KEY) === '1');
    } catch {}
  }, []);
  const toggleCollapsed = () =>
    setCollapsed((prev) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, prev ? '0' : '1');
      } catch {}
      return !prev;
    });
  // Labels hide only at md+ so the mobile drawer is unaffected.
  const labelClass = collapsed ? 'md:sr-only' : '';

  const toggle = (href: string) => setExpanded((prev) => ({ ...prev, [href]: !prev[href] }));

  const isActive = (href: string) => {
    if (href === '/admin/dashboard') {
      return pathname === '/admin' || pathname === '/admin/dashboard';
    }
    // Exact match always wins
    if (pathname === href) return true;
    // Sub-route match, but skip if a more specific nav item owns this path
    // (e.g. /admin/orders/scan should match "Check In", not "Orders")
    if (pathname.startsWith(href + '/')) {
      const moreSpecific = allItems.some(
        (item) =>
          item.href !== href && item.href.startsWith(href + '/') && pathname.startsWith(item.href)
      );
      return !moreSpecific;
    }
    return false;
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
          fixed top-0 left-0 z-40 h-full w-64 shrink-0 bg-white dark:bg-slate-800
          border-r border-gray-200 dark:border-slate-700
          transform transition-[transform,width] duration-200 ease-in-out motion-reduce:transition-none
          ${collapsed ? 'md:w-16' : ''}
          md:relative md:translate-x-0 md:z-auto
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <div
            className={`flex items-center justify-between px-4 py-4 ${
              collapsed ? 'md:justify-center md:px-2' : ''
            }`}
          >
            <Link
              href="/admin/dashboard"
              className="rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
              onClick={onClose}
            >
              {collapsed ? (
                <>
                  <EventimusLogo className="h-5 md:hidden" />
                  <EventimusLogo symbolOnly className="hidden h-6 md:block" />
                </>
              ) : (
                <EventimusLogo />
              )}
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
              const Icon = item.icon;
              const children = item.children?.filter(
                (child) => !child.roles || child.roles.includes(userRole)
              );
              const link = (
                <Link
                  href={item.href}
                  onClick={onClose}
                  aria-current={active ? 'page' : undefined}
                  title={collapsed ? item.label : undefined}
                  className={`${linkClass(active)} flex-1 min-w-0 ${
                    collapsed ? 'md:justify-center md:px-0' : ''
                  }`}
                >
                  {Icon && (
                    <Icon
                      className={`w-4 h-4 mr-3 shrink-0 ${collapsed ? 'md:mr-0' : ''}`}
                      aria-hidden="true"
                    />
                  )}
                  <span className={labelClass}>{item.label}</span>
                </Link>
              );

              if (!children?.length) {
                return <div key={item.href}>{link}</div>;
              }

              const open = !!expanded[item.href];
              const panelId = `sidebar-section-${item.href.replace(/\W+/g, '-')}`;
              return (
                <div key={item.href} data-testid={`sidebar-section-${item.label}`}>
                  <div className="flex items-center gap-1">
                    {link}
                    <button
                      type="button"
                      onClick={() => toggle(item.href)}
                      aria-expanded={open}
                      aria-controls={panelId}
                      aria-label={`${open ? 'Collapse' : 'Expand'} ${item.label}`}
                      className={`${collapsed ? 'md:hidden ' : ''}p-2 rounded-md text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-700 hover:text-gray-700 dark:hover:text-slate-200 focus:outline-none focus:ring-2 focus:ring-accent-500`}
                    >
                      <ChevronRight
                        className={`w-4 h-4 transition-transform motion-reduce:transition-none ${
                          open ? 'rotate-90' : ''
                        }`}
                        aria-hidden="true"
                      />
                    </button>
                  </div>
                  <div
                    id={panelId}
                    hidden={!open}
                    className={`mt-1 space-y-1 ${collapsed ? 'md:hidden' : ''}`}
                  >
                    {children.map((child) => {
                      const childActive = isActive(child.href);
                      return (
                        <Link
                          key={child.href}
                          href={child.href}
                          onClick={onClose}
                          aria-current={childActive ? 'page' : undefined}
                          className={`${linkClass(childActive)} ml-4 pl-6`}
                        >
                          {child.label}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </nav>

          {/* Settings remains pinned and visible when the navigation list scrolls. */}
          <div
            className={`flex items-center gap-1 px-3 py-4 border-t border-gray-200 dark:border-slate-700 ${
              collapsed ? 'md:flex-col md:px-2' : ''
            }`}
          >
            <Link
              href="/admin/settings"
              onClick={onClose}
              title={collapsed ? 'Settings' : undefined}
              className={`flex flex-1 items-center min-w-0 px-3 py-2 text-sm font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-accent-500 ${
                collapsed ? 'md:w-full md:flex-none md:justify-center md:px-0' : ''
              } ${
                isActive('/admin/settings')
                  ? 'bg-accent-50 dark:bg-accent-900/30 text-accent-700 dark:text-accent-300'
                  : 'text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700'
              }`}
            >
              <Settings
                className={`w-4 h-4 mr-3 shrink-0 ${collapsed ? 'md:mr-0' : ''}`}
                aria-hidden="true"
              />
              <span className={labelClass}>Settings</span>
            </Link>
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-expanded={!collapsed}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              data-testid="sidebar-collapse-toggle"
              className="hidden md:block p-2 rounded-md text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-700 hover:text-gray-700 dark:hover:text-slate-200 focus:outline-none focus:ring-2 focus:ring-accent-500"
            >
              {collapsed ? (
                <PanelLeftOpen className="w-4 h-4" aria-hidden="true" />
              ) : (
                <PanelLeftClose className="w-4 h-4" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
