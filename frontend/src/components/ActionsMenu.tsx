'use client';

// Generic `⋯` menu (the RowActionsMenu keyboard pattern, spec 019): arrows
// move, Escape closes, focus returns to the button, outside click closes.
// Items are links or actions; a danger item is last and red.

import Link from 'next/link';
import { MoreHorizontal } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

export interface ActionsMenuItem {
  label: string;
  href?: string;
  external?: boolean;
  onSelect?: (trigger: HTMLButtonElement) => void;
  danger?: boolean;
  disabled?: boolean;
}

const item =
  'block w-full px-3 py-2 text-left text-sm hover:bg-gray-100 focus:bg-gray-100 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-slate-700 dark:focus:bg-slate-700';

export default function ActionsMenu({ label, items, align = 'right' }: { label: string; items: ActionsMenuItem[]; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !buttonRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const all = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])];
    const i = all.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      all[(i + 1) % all.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      all[(i - 1 + all.length) % all.length]?.focus();
    } else if (e.key === 'Tab') {
      close(false);
    }
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden />
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKey}
          className={`absolute z-30 mt-1 min-w-[12rem] overflow-hidden rounded-md border border-gray-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800 ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {items.map((entry) => {
            const tone = entry.danger ? 'text-red-700 dark:text-red-400' : 'text-gray-800 dark:text-slate-100';
            if (entry.href) {
              return entry.external ? (
                <a key={entry.label} role="menuitem" href={entry.href} target="_blank" rel="noreferrer" className={`${item} ${tone}`} onClick={() => close(false)}>
                  {entry.label}
                </a>
              ) : (
                <Link key={entry.label} role="menuitem" href={entry.href} className={`${item} ${tone}`} onClick={() => close(false)}>
                  {entry.label}
                </Link>
              );
            }
            return (
              <button
                key={entry.label}
                type="button"
                role="menuitem"
                disabled={entry.disabled}
                className={`${item} ${tone}`}
                onClick={() => {
                  close(false);
                  if (buttonRef.current) entry.onSelect?.(buttonRef.current);
                }}
              >
                {entry.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
