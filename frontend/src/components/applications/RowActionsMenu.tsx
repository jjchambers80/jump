'use client';

// The `⋯` menu on a submissions row (spec 019): View, the decisions the row's
// status allows, and Copy status link. Keyboard: arrows move, Escape closes,
// focus returns to the button.

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { DECISION_LABEL, decisionsFor, type ApplicationRow, type Decision } from '@/lib/applications';

interface RowActionsMenuProps {
  row: ApplicationRow;
  detailHref: string;
  onDecision: (decision: Decision, trigger: HTMLButtonElement) => void;
  onNotice: (text: string) => void;
}

const item = 'block w-full px-3 py-1.5 text-left text-sm text-gray-800 hover:bg-gray-100 focus:bg-gray-100 focus:outline-none dark:text-slate-100 dark:hover:bg-slate-700 dark:focus:bg-slate-700';

export default function RowActionsMenu({ row, detailHref, onDecision, onNotice }: RowActionsMenuProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const decisions = decisionsFor(row.status);

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

  const copyStatusLink = async () => {
    close();
    if (!row.statusUrl) return;
    try {
      await navigator.clipboard.writeText(row.statusUrl);
      onNotice('Status link copied.');
    } catch {
      window.prompt('Copy the status link', row.statusUrl);
    }
  };

  return (
    <div className="relative inline-block text-left">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions for ${row.businessName}`}
        onClick={() => setOpen((o) => !o)}
        className="rounded-md px-2 py-1 text-lg leading-none text-gray-600 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-700"
        data-testid={`application-actions-${row.id}`}
      >
        ⋯
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={`Actions for ${row.businessName}`}
          onKeyDown={onMenuKey}
          className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-md border border-gray-200 bg-white py-1 shadow-lg dark:border-slate-600 dark:bg-slate-800"
        >
          <button type="button" role="menuitem" className={item} onClick={() => { close(false); router.push(detailHref); }}>
            View
          </button>
          {decisions.map((d) => (
            <button key={d} type="button" role="menuitem" className={item} onClick={() => { close(false); onDecision(d, buttonRef.current!); }}>
              {DECISION_LABEL[d]}
            </button>
          ))}
          {row.statusUrl && (
            <button type="button" role="menuitem" className={item} onClick={copyStatusLink}>
              Copy status link
            </button>
          )}
        </div>
      )}
    </div>
  );
}
