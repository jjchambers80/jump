'use client';

// The ⋯ menu on an event card (spec 035 D3). Follows the RowActionsMenu keyboard
// pattern from spec 019: arrows move between items, Escape closes, focus returns
// to the trigger button. Items: Event page, Applications, Duplicate, Copy link,
// Cancel event… (destructive, last, red).

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';

interface EventActionsMenuProps {
  eventId: string;
  eventName: string;
  /** May be null until 035A lands. */
  slug?: string | null;
  selectedOrgId: string | null;
  onDuplicate: () => void;
  onCancelEvent: () => void;
}

const itemBase =
  'block w-full px-3 py-1.5 text-left text-sm text-gray-800 hover:bg-gray-100 focus:bg-gray-100 focus:outline-none dark:text-slate-100 dark:hover:bg-slate-700 dark:focus:bg-slate-700';

const destructiveItem = `${itemBase} text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 focus:bg-red-50 dark:focus:bg-red-900/20`;

export default function EventActionsMenu({
  eventId,
  eventName,
  slug,
  selectedOrgId,
  onDuplicate,
  onCancelEvent,
}: EventActionsMenuProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !buttonRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(i + 1) % items.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(i - 1 + items.length) % items.length]?.focus();
    }
  };

  const eventPageHref = slug ? `/events/${encodeURIComponent(slug)}` : `/events/${eventId}`;

  const copyLink = async () => {
    close();
    const fullUrl = `${window.location.origin}${eventPageHref}`;
    try {
      await navigator.clipboard.writeText(fullUrl);
    } catch {
      window.prompt('Copy the event link', fullUrl);
    }
  };

  return (
    <div className="relative inline-block text-left">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`More actions for ${eventName}`}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-[28px] min-w-[28px] items-center justify-center rounded-md text-lg leading-none text-gray-500 hover:bg-gray-100 dark:text-slate-400 dark:hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        ⋯
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={`More actions for ${eventName}`}
          onKeyDown={onMenuKey}
          className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-md border border-gray-200 bg-white py-1 shadow-lg dark:border-slate-600 dark:bg-slate-800"
        >
          <button
            type="button"
            role="menuitem"
            className={itemBase}
            onClick={() => { close(false); window.open(eventPageHref, '_blank', 'noopener'); }}
          >
            Event page
          </button>
          <button
            type="button"
            role="menuitem"
            className={itemBase}
            onClick={() => { close(false); router.push(`/admin/events/${eventId}/applications`); }}
          >
            Applications
          </button>
          <button
            type="button"
            role="menuitem"
            className={itemBase}
            onClick={() => { close(false); onDuplicate(); }}
          >
            Duplicate
          </button>
          <button
            type="button"
            role="menuitem"
            className={itemBase}
            onClick={copyLink}
          >
            Copy link
          </button>
          <hr className="my-1 border-gray-200 dark:border-slate-600" />
          <button
            type="button"
            role="menuitem"
            className={destructiveItem}
            onClick={() => { close(false); onCancelEvent(); }}
          >
            Cancel event…
          </button>
        </div>
      )}
    </div>
  );
}