'use client';

// A price tier as a card in the tier list (event editor and setup wizard).
// Actions are 44px targets; a tier that cannot be removed says why in text.

import React from 'react';
import { ArrowDown, ArrowUp, Copy, Trash2 } from 'lucide-react';
import type { TierFormData } from './TierEditDialog';

const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500';
const iconBtn = `inline-flex h-11 w-11 items-center justify-center rounded-md text-gray-600 hover:bg-gray-100 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white ${focusRing}`;
const textBtn = `inline-flex min-h-11 items-center rounded-md border border-gray-300 px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700 ${focusRing}`;
const VISIBILITY_TONE = {
  PUBLIC: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  PRIVATE: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  HIDDEN: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
};

interface TierCardProps {
  tier: TierFormData;
  index: number;
  total: number;
  canDelete: boolean;
  deleteBlockedReason?: string;
  onEdit: () => void;
  onMove: (direction: 'up' | 'down') => void;
  onDelete: () => void;
  /** Adds a copy of this tier (wizard). */
  onDuplicate?: () => void;
  /** Turns selling this tier on or off (wizard; the tier's isActive). */
  onToggleActive?: () => void;
  /** Background class for the left edge strip and sold bar (matches the capacity meter). */
  accentClass?: string;
  /** A line under the price, e.g. the all-in price buyers pay. */
  priceNote?: string;
  /** Id of the Edit button: focus returns there after a deep-linked dialog closes. */
  editButtonId?: string;
}

export function TierCard({
  tier, index, total, canDelete, deleteBlockedReason, onEdit, onMove, onDelete, onDuplicate, onToggleActive, accentClass, priceNote, editButtonId,
}: TierCardProps) {
  const reasonId = `tier-delete-reason-${tier.key}`;
  const active = tier.isActive !== false;
  const qty = Number(tier.quantityTotal) || 0;
  const sold = tier.quantitySold ?? 0;
  const label = tier.name || 'untitled tier';
  const priceDisplay = tier.price ? (Number(tier.price) === 0 ? 'Free' : `$${Number(tier.price).toFixed(2)}`) : '—';

  return (
    <div
      className="relative flex cursor-pointer flex-col gap-2 overflow-hidden rounded-lg border border-gray-200 bg-white p-3 pl-4 transition-colors hover:border-accent-300 motion-reduce:transition-none dark:border-slate-600 dark:bg-slate-800 dark:hover:border-accent-600 sm:flex-row sm:items-center sm:gap-4 sm:p-4 sm:pl-5"
      onClick={onEdit}
    >
      {accentClass && <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${accentClass}`} />}
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          <h3 className="truncate text-sm font-semibold text-gray-900 dark:text-white">{tier.name || 'Untitled Tier'}</h3>
          {!active && (
            <span className="inline-flex shrink-0 items-center rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-700 dark:bg-slate-700 dark:text-slate-200">
              Off sale
            </span>
          )}
          {tier.isNew && (
            <span className="inline-flex shrink-0 items-center rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-700 dark:bg-slate-700 dark:text-slate-200">
              new
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600 dark:text-slate-400">
          <span className="text-sm font-medium text-gray-900 dark:text-white">{priceDisplay}</span>
          <span>
            {tier.quantityTotal ? `${tier.quantityTotal} qty` : 'No qty set'}
            {sold > 0 && <span> ({sold} sold)</span>}
          </span>
          <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${VISIBILITY_TONE[tier.visibility]}`}>
            {tier.visibility.charAt(0) + tier.visibility.slice(1).toLowerCase()}
          </span>
          {tier.isRefundable && (
            <span className="rounded bg-accent-100 px-1.5 py-0.5 text-xs font-medium text-accent-800 dark:bg-accent-900/30 dark:text-accent-300">
              Refundable
            </span>
          )}
        </div>
        {priceNote && <p className="mt-1 text-xs text-gray-600 dark:text-slate-400">{priceNote}</p>}
        {!canDelete && deleteBlockedReason && (
          <p id={reasonId} className="mt-1 text-xs text-gray-600 dark:text-slate-400">
            {deleteBlockedReason}
          </p>
        )}
        {accentClass && !tier.isNew && qty > 0 && (
          <div aria-hidden className="mt-2 h-1 w-full max-w-48 overflow-hidden rounded-full bg-gray-100 dark:bg-slate-700">
            <div className={`h-full ${accentClass}`} style={{ width: `${Math.min(sold / qty, 1) * 100}%` }} />
          </div>
        )}
      </div>

      <div className="-ml-2 flex shrink-0 flex-wrap items-center gap-1 sm:ml-0" onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={() => onMove('up')} disabled={index === 0} className={iconBtn} title="Move up" aria-label={`Move ${label} up`}>
          <ArrowUp className="h-4 w-4" aria-hidden />
        </button>
        <button type="button" onClick={() => onMove('down')} disabled={index === total - 1} className={iconBtn} title="Move down" aria-label={`Move ${label} down`}>
          <ArrowDown className="h-4 w-4" aria-hidden />
        </button>
        <button id={editButtonId} type="button" onClick={onEdit} aria-label={`Edit ${label}`} className={textBtn}>
          Edit
        </button>
        {onToggleActive && (
          <button type="button" onClick={onToggleActive} aria-label={`${active ? 'Turn off' : 'Turn on'} ${label}`} className={textBtn}>
            {active ? 'Turn off' : 'Turn on'}
          </button>
        )}
        {onDuplicate && (
          <button type="button" onClick={onDuplicate} aria-label={`Duplicate ${label}`} title="Duplicate" className={iconBtn}>
            <Copy className="h-4 w-4" aria-hidden />
          </button>
        )}
        <button
          type="button"
          onClick={() => canDelete && onDelete()}
          disabled={!canDelete}
          title={canDelete ? 'Remove tier' : undefined}
          aria-label={`Remove ${label}`}
          aria-describedby={!canDelete && deleteBlockedReason ? reasonId : undefined}
          className={`${iconBtn} ${canDelete ? 'text-red-700 hover:bg-red-50 hover:text-red-800 dark:text-red-400 dark:hover:bg-red-900/20' : ''}`}
        >
          <Trash2 className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
