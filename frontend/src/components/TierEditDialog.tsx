'use client';

// Price tier card and edit dialog, shared by the event editor and the setup
// wizard's Tickets step (spec 050 §8.1). The dialog is modal (focus trap,
// Escape, focus back to its opener via useDialog); sale windows are typed in
// the venue's time zone, which the dialog names when it is given `zone`.

import React, { useState } from 'react';
import { ArrowDown, ArrowUp, Copy, Trash2, X } from 'lucide-react';
import { useDialog } from '@/lib/useDialog';
import { DEFAULT_ZONE } from '@/lib/eventTime';
import { timeZoneLabel } from '@/lib/timeZones';

export interface TierFormData {
  key: string;
  isNew?: boolean;
  name: string;
  description: string;
  price: string;
  quantityTotal: string;
  quantitySold?: number;
  quantityReserved?: number;
  minPerOrder: string;
  maxPerOrder: string;
  saleStartDate: string;
  saleEndDate: string;
  visibility: 'PUBLIC' | 'PRIVATE' | 'HIDDEN';
  isRefundable: boolean;
  isActive?: boolean;
}

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
  /** Background class for the left edge strip and sold bar (matches the capacity meter). */
  accentClass?: string;
  /** A line under the price, e.g. the all-in price buyers pay. */
  priceNote?: string;
  /** Id of the Edit button: focus returns there after a deep-linked dialog closes. */
  editButtonId?: string;
}

export function TierCard({
  tier, index, total, canDelete, deleteBlockedReason, onEdit, onMove, onDelete, onDuplicate, accentClass, priceNote, editButtonId,
}: TierCardProps) {
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
        {onDuplicate && (
          <button type="button" onClick={onDuplicate} aria-label={`Duplicate ${label}`} title="Duplicate" className={iconBtn}>
            <Copy className="h-4 w-4" aria-hidden />
          </button>
        )}
        <button
          type="button"
          onClick={() => canDelete && onDelete()}
          disabled={!canDelete}
          title={canDelete ? 'Remove tier' : deleteBlockedReason}
          aria-label={canDelete ? `Remove ${label}` : deleteBlockedReason || 'Remove tier'}
          className={`${iconBtn} ${canDelete ? 'text-red-700 hover:bg-red-50 hover:text-red-800 dark:text-red-400 dark:hover:bg-red-900/20' : ''}`}
        >
          <Trash2 className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}

interface TierEditDialogProps {
  tier: TierFormData;
  index: number;
  onSave: (updated: TierFormData) => void;
  onCancel: () => void;
  /** The venue's zone: sale windows are typed in it (spec 033). */
  zone?: string | null;
  /** Problems to show above the fields (validation or a refused save). */
  errors?: string[];
  /** A save is in flight: the save button waits. */
  busy?: boolean;
  saveLabel?: string;
}

const inputClass =
  'block w-full min-h-11 sm:min-h-10 rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-gray-900 dark:text-slate-100 shadow-sm focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500';
const labelClass = 'block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1';

export function TierEditDialog({ tier, index, onSave, onCancel, zone, errors = [], busy = false, saveLabel = 'Done' }: TierEditDialogProps) {
  const [draft, setDraft] = useState<TierFormData>({ ...tier });
  const panelRef = useDialog<HTMLDivElement>(true, onCancel);
  const update = (field: keyof TierFormData, value: string | boolean) => setDraft((prev) => ({ ...prev, [field]: value }));
  const floor = (draft.quantitySold || 0) + (draft.quantityReserved || 0);
  const titleId = `tier-dialog-title-${tier.key}`;
  const field = (name: string) => `tier-${name}-${tier.key}`;

  React.useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div aria-hidden className="pointer-events-none fixed inset-0 bg-black/50" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative max-h-[90vh] w-full overflow-y-auto rounded-t-xl bg-white shadow-xl dark:bg-slate-800 sm:max-w-lg sm:rounded-lg"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-2 dark:border-slate-700 dark:bg-slate-800 sm:px-6">
          <h2 id={titleId} className="text-lg font-semibold text-gray-900 dark:text-white">
            {tier.isNew ? `New Tier ${index + 1}` : `Edit Tier ${index + 1}`}
          </h2>
          <button type="button" onClick={onCancel} aria-label="Close" className={iconBtn}>
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <div className="space-y-4 px-4 py-4 sm:px-6">
          {errors.length > 0 && (
            <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
              <ul className="list-disc space-y-0.5 pl-5">
                {errors.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <label htmlFor={field('name')} className={labelClass}>Tier Name *</label>
            <input id={field('name')} type="text" value={draft.name} onChange={(e) => update('name', e.target.value)} placeholder="e.g. General Admission" className={inputClass} required maxLength={255} />
          </div>
          <div>
            <label htmlFor={field('description')} className={labelClass}>Description</label>
            <textarea id={field('description')} value={draft.description} onChange={(e) => update('description', e.target.value)} placeholder="Brief description (optional)" maxLength={500} rows={2} className={inputClass} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor={field('price')} className={labelClass}>Price ($) *</label>
              <input id={field('price')} type="number" value={draft.price} onChange={(e) => update('price', e.target.value)} placeholder="0.00" min={0} step="0.01" className={inputClass} required />
            </div>
            <div>
              <label htmlFor={field('quantity')} className={labelClass}>Quantity *</label>
              <input id={field('quantity')} type="number" value={draft.quantityTotal} onChange={(e) => update('quantityTotal', e.target.value)} placeholder="100" min={draft.isNew ? 1 : floor} className={inputClass} required aria-describedby={!draft.isNew && floor > 0 ? field('quantity-hint') : undefined} />
              {!draft.isNew && floor > 0 && (
                <p id={field('quantity-hint')} className="mt-0.5 text-xs text-gray-600 dark:text-slate-400">Min: {floor} (sold + reserved)</p>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor={field('min')} className={labelClass}>Min / Order</label>
              <input id={field('min')} type="number" value={draft.minPerOrder} onChange={(e) => update('minPerOrder', e.target.value)} min={1} className={inputClass} />
            </div>
            <div>
              <label htmlFor={field('max')} className={labelClass}>Max / Order</label>
              <input id={field('max')} type="number" value={draft.maxPerOrder} onChange={(e) => update('maxPerOrder', e.target.value)} min={1} className={inputClass} />
            </div>
          </div>
          <fieldset className="border-t border-gray-100 pt-4 dark:border-slate-700" aria-describedby={zone !== undefined ? field('zone') : undefined}>
            <legend className="sr-only">Sale window</legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor={field('sale-start')} className={labelClass}>Sale Start</label>
                <input id={field('sale-start')} type="datetime-local" value={draft.saleStartDate} onChange={(e) => update('saleStartDate', e.target.value)} className={inputClass} />
              </div>
              <div>
                <label htmlFor={field('sale-end')} className={labelClass}>Sale End</label>
                <input id={field('sale-end')} type="datetime-local" value={draft.saleEndDate} onChange={(e) => update('saleEndDate', e.target.value)} className={inputClass} />
              </div>
            </div>
            {zone !== undefined && (
              <p id={field('zone')} className="mt-1 text-xs text-gray-600 dark:text-slate-400">
                In the venue&apos;s time zone: {timeZoneLabel(zone || DEFAULT_ZONE)}
              </p>
            )}
          </fieldset>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor={field('visibility')} className={labelClass}>Visibility</label>
              <select id={field('visibility')} value={draft.visibility} onChange={(e) => update('visibility', e.target.value)} className={inputClass}>
                <option value="PUBLIC">Public</option>
                <option value="PRIVATE">Private</option>
                <option value="HIDDEN">Hidden</option>
              </select>
            </div>
            <div className="flex items-end">
              <label className="flex min-h-11 cursor-pointer items-center gap-2">
                <input type="checkbox" checked={draft.isRefundable} onChange={(e) => update('isRefundable', e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-accent-600 focus:ring-accent-500 dark:border-slate-600" />
                <span className="text-sm text-gray-700 dark:text-slate-300">Refundable</span>
              </label>
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 flex justify-end gap-3 border-t border-gray-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-800 sm:px-6">
          <button type="button" onClick={onCancel} className={textBtn}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave(draft)}
            disabled={busy}
            className={`inline-flex min-h-11 items-center rounded-md bg-accent-500 px-4 text-sm font-semibold text-gray-950 shadow-sm hover:bg-accent-hover disabled:opacity-60 ${focusRing}`}
          >
            {busy ? 'Saving…' : saveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
