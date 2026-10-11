// One lineup row in the editor: photo, name and role, the visibility toggle,
// move up / down buttons (no drag-only control) and edit / remove.

import { ArrowDown, ArrowUp, Pencil, Trash2, UserRound } from 'lucide-react';
import { resolveAssetUrl } from '@/lib/assets';
import type { AdminEventGuest } from '@/lib/eventGuests';
import { iconButton } from '../ui';

interface Props {
  guest: AdminEventGuest;
  index: number;
  count: number;
  onMove: (delta: -1 | 1) => void;
  onToggle: (visible: boolean) => void;
  onEdit: () => void;
  onRemove: () => void;
}

export default function GuestRow({ guest, index, count, onMove, onToggle, onEdit, onRemove }: Props) {
  const src = resolveAssetUrl(guest.imageUrl);
  const toggleId = `guest-visible-${guest.id}`;
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800" data-testid="lineup-row">
      <div className="relative size-12 shrink-0 overflow-hidden rounded-md bg-gray-100 dark:bg-slate-700">
        {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : <UserRound className="absolute inset-0 m-auto size-6 text-gray-400" aria-hidden />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-gray-900 dark:text-white">{guest.name}</p>
        <p className="truncate text-sm text-gray-600 dark:text-slate-400">
          {guest.role || 'No role'}
          {!guest.isVisible && <span className="ml-2 font-medium text-gray-700 dark:text-slate-300">· Hidden</span>}
        </p>
      </div>
      <div className="flex w-full items-center justify-between gap-1 sm:w-auto">
        <label htmlFor={toggleId} className="inline-flex min-h-11 cursor-pointer items-center gap-2 px-2 text-sm text-gray-700 dark:text-slate-300">
          <input id={toggleId} type="checkbox" checked={guest.isVisible} onChange={(e) => onToggle(e.target.checked)} className="size-4" />
          Show on event page
        </label>
        <div className="flex items-center">
          <button type="button" className={`${iconButton} disabled:opacity-40`} onClick={() => onMove(-1)} disabled={index === 0} aria-label={`Move ${guest.name} up`}>
            <ArrowUp className="h-5 w-5" aria-hidden />
          </button>
          <button type="button" className={`${iconButton} disabled:opacity-40`} onClick={() => onMove(1)} disabled={index === count - 1} aria-label={`Move ${guest.name} down`}>
            <ArrowDown className="h-5 w-5" aria-hidden />
          </button>
          <button type="button" className={iconButton} onClick={onEdit} aria-label={`Edit ${guest.name}`}>
            <Pencil className="h-5 w-5" aria-hidden />
          </button>
          <button type="button" className={iconButton} onClick={onRemove} aria-label={`Remove ${guest.name}`}>
            <Trash2 className="h-5 w-5" aria-hidden />
          </button>
        </div>
      </div>
    </li>
  );
}
