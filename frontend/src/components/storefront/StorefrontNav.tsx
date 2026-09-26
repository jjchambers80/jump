'use client';

// Main menu on the storefront: desktop row with hover / click dropdowns (two
// nested levels), mobile hamburger drawer with accordion. Brand tokens for
// the active state; motion is short and off under prefers-reduced-motion.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown, Menu as MenuIcon, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { PublicMenuItem } from '@/lib/menus';
import { storefrontHref } from '@/lib/storefrontPath';

interface StorefrontNavProps {
  orgId: string;
  items: PublicMenuItem[];
  /** Which rendering this instance owns; the header mounts one of each. */
  variant?: 'desktop' | 'mobile';
  className?: string;
}

function NavLink({
  item,
  orgId,
  className,
  onNavigate,
}: {
  item: PublicMenuItem;
  orgId: string;
  className: string;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const href = storefrontHref(item.href, orgId);
  const external = /^https?:\/\//i.test(href) || item.newTab;
  const current =
    !external &&
    (pathname === href.split('#')[0] ||
      (href.split('#')[0] !== '/' && pathname.startsWith(`${href.split('#')[0]}/`)));
  if (external) {
    return (
      <a
        href={href}
        target={item.newTab ? '_blank' : undefined}
        rel={item.newTab ? 'noopener' : undefined}
        className={className}
        onClick={onNavigate}
      >
        {item.label}
      </a>
    );
  }
  return (
    <Link
      href={href}
      aria-current={current ? 'page' : undefined}
      className={className}
      onClick={onNavigate}
    >
      {item.label}
    </Link>
  );
}

function Dropdown({ item, orgId }: { item: PublicMenuItem; orgId: string }) {
  const [open, setOpen] = useState(false);
  // Hover opens transiently; a click pins the panel open until the next click / Escape / outside click.
  const [pinned, setPinned] = useState(false);
  const ref = useRef<HTMLLIElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>();
  const id = `nav-${item.id}`;

  const close = () => {
    setOpen(false);
    setPinned(false);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close();
        ref.current?.querySelector('button')?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const hoverOpen = () => {
    clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const hoverClose = () => {
    if (pinned) return;
    closeTimer.current = setTimeout(() => setOpen(false), 150);
  };
  const toggle = () => {
    clearTimeout(closeTimer.current);
    if (pinned) close();
    else {
      setOpen(true);
      setPinned(true);
    }
  };

  return (
    <li ref={ref} className="relative" onMouseEnter={hoverOpen} onMouseLeave={hoverClose}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={toggle}
        className="inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium text-gray-700 hover:text-brand-link focus:outline-none focus:ring-2 focus:ring-brand dark:text-slate-200"
      >
        {item.label}
        <ChevronDown
          className={`h-4 w-4 transition-transform duration-150 motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>
      {open && (
        <div
          id={id}
          className="absolute left-0 top-full z-30 mt-1 min-w-[14rem] rounded-lg border border-gray-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-800"
        >
          <ul className="space-y-0.5">
            {item.children.map((child) => (
              <li key={child.id}>
                <NavLink
                  item={child}
                  orgId={orgId}
                  className="block rounded-md px-3 py-1.5 text-sm text-gray-800 hover:bg-gray-50 hover:text-brand-link aria-[current=page]:font-semibold aria-[current=page]:text-brand-link dark:text-slate-100 dark:hover:bg-slate-700"
                />
                {child.children.length > 0 && (
                  <ul className="ml-3 border-l border-gray-200 pl-2 dark:border-slate-600">
                    {child.children.map((grand) => (
                      <li key={grand.id}>
                        <NavLink
                          item={grand}
                          orgId={orgId}
                          className="block rounded-md px-3 py-1 text-sm text-gray-600 hover:bg-gray-50 hover:text-brand-link aria-[current=page]:text-brand-link dark:text-slate-300 dark:hover:bg-slate-700"
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

function DrawerItem({
  item,
  orgId,
  depth,
  onNavigate,
}: {
  item: PublicMenuItem;
  orgId: string;
  depth: number;
  onNavigate: () => void;
}) {
  const [open, setOpen] = useState(false);
  const padding = depth === 0 ? 'pl-4' : depth === 1 ? 'pl-8' : 'pl-12';
  if (!item.children.length) {
    return (
      <li>
        <NavLink
          item={item}
          orgId={orgId}
          onNavigate={onNavigate}
          className={`block ${padding} py-3 pr-4 text-base text-gray-800 aria-[current=page]:font-semibold aria-[current=page]:text-brand-link dark:text-slate-100`}
        />
      </li>
    );
  }
  return (
    <li>
      <div className="flex items-center">
        <NavLink
          item={item}
          orgId={orgId}
          onNavigate={onNavigate}
          className={`flex-1 ${padding} py-3 text-base text-gray-800 aria-[current=page]:font-semibold aria-[current=page]:text-brand-link dark:text-slate-100`}
        />
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? `Collapse ${item.label}` : `Expand ${item.label}`}
          onClick={() => setOpen((v) => !v)}
          className="mr-2 inline-flex h-11 w-11 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-700"
        >
          <ChevronDown
            className={`h-5 w-5 transition-transform duration-150 motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
            aria-hidden
          />
        </button>
      </div>
      {open && (
        <ul>
          {item.children.map((child) => (
            <DrawerItem
              key={child.id}
              item={child}
              orgId={orgId}
              depth={depth + 1}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function StorefrontNav({
  orgId,
  items,
  variant = 'desktop',
  className = '',
}: StorefrontNavProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!drawerOpen) return;
    closeButtonRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      openButtonRef.current?.focus();
    };
  }, [drawerOpen]);

  if (!items.length) return null;

  if (variant === 'desktop') {
    return (
      <nav aria-label="Main" className={className} data-testid="storefront-nav">
        <ul className="flex items-center gap-1">
          {items.map((item) =>
            item.children.length ? (
              <Dropdown key={item.id} item={item} orgId={orgId} />
            ) : (
              <li key={item.id}>
                <NavLink
                  item={item}
                  orgId={orgId}
                  className="inline-flex rounded-md px-3 py-2 text-sm font-medium text-gray-700 hover:text-brand-link focus:outline-none focus:ring-2 focus:ring-brand aria-[current=page]:text-brand-link dark:text-slate-200"
                />
              </li>
            )
          )}
        </ul>
      </nav>
    );
  }

  return (
    <nav aria-label="Main menu" className={className} data-testid="storefront-nav-mobile">
      <button
        ref={openButtonRef}
        type="button"
        aria-label="Open menu"
        aria-expanded={drawerOpen}
        aria-controls="storefront-drawer"
        onClick={() => setDrawerOpen(true)}
        className="inline-flex h-11 w-11 items-center justify-center rounded-md text-gray-700 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-brand dark:text-slate-200 dark:hover:bg-slate-700"
      >
        <MenuIcon className="h-6 w-6" aria-hidden />
      </button>
      {drawerOpen && (
        <div className="fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setDrawerOpen(false)}
            aria-hidden
          />
          <div
            id="storefront-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            className="absolute inset-y-0 left-0 flex w-80 max-w-[85vw] flex-col bg-white shadow-xl dark:bg-slate-900"
          >
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-slate-700">
              <span className="text-sm font-semibold text-gray-900 dark:text-white">Menu</span>
              <button
                ref={closeButtonRef}
                type="button"
                aria-label="Close menu"
                onClick={() => setDrawerOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
            <ul className="flex-1 overflow-y-auto py-2">
              {items.map((item) => (
                <DrawerItem
                  key={item.id}
                  item={item}
                  orgId={orgId}
                  depth={0}
                  onNavigate={() => setDrawerOpen(false)}
                />
              ))}
            </ul>
          </div>
        </div>
      )}
    </nav>
  );
}
