// Small pieces shared by the Lists tab and a list's page (spec 055).

import type { ActionsMenuItem } from '@/components/ActionsMenu';
import { contactListHref, type ContactList, type ContactListType } from '@/lib/contactLists';

export function ListTypeBadge({ type }: { type: ContactListType }) {
  return type === 'AUTOMATIC' ? (
    <span className="inline-flex rounded-full border border-accent-300 bg-accent-50 px-2 py-0.5 text-xs font-medium text-accent-900 dark:border-accent-700 dark:bg-accent-900/30 dark:text-accent-100">
      Automatic
    </span>
  ) : (
    <span className="inline-flex rounded-full border border-gray-300 bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-800 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100">
      Manual
    </span>
  );
}

const relative = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

/** "2 days ago", "8 months ago", "just now". */
export function formatRelative(iso: string, now = Date.now()): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return 'just now';
}

/** Row and page menu: Open, Export CSV, Edit / Rename, Duplicate, Delete. Built-ins can only be opened, exported and duplicated. */
export function listMenuItems(
  list: ContactList,
  {
    canEdit,
    open = true,
    edit = true,
    onEdit,
    onDuplicate,
    onDelete,
    onExport,
  }: {
    canEdit: boolean;
    /** Include Open (the list's own page leaves it out). */
    open?: boolean;
    /** Include Edit / Rename (the list's page has its own button). */
    edit?: boolean;
    onEdit?: (trigger: HTMLButtonElement) => void;
    onDuplicate: () => void;
    onDelete: (trigger: HTMLButtonElement) => void;
    /** Set when the user may export (customers.export). */
    onExport?: () => void;
  }
): ActionsMenuItem[] {
  const items: ActionsMenuItem[] = open ? [{ label: 'Open', href: contactListHref(list.id) }] : [];
  if (onExport) items.push({ label: 'Export CSV', onSelect: onExport });
  if (!canEdit) return items;
  if (edit && !list.builtIn) items.push({ label: list.type === 'AUTOMATIC' ? 'Edit list' : 'Rename', onSelect: onEdit });
  items.push({ label: 'Duplicate', onSelect: onDuplicate });
  if (!list.builtIn) items.push({ label: 'Delete', danger: true, onSelect: onDelete });
  return items;
}
