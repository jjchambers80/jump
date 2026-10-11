'use client';

// Price tier card and edit dialog, shared by the event editor and the setup
// wizard's Tickets step (spec 050 §8.1). The dialog is modal (focus trap,
// Escape, focus back to its opener via useDialog); sale windows are typed in
// the venue's time zone, which the dialog names when it is given `zone`.

import React, { useState } from 'react';
import { X } from 'lucide-react';
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
const iconBtn = `inline-flex h-11 w-11 items-center justify-center rounded-md text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white ${focusRing}`;
const textBtn = `inline-flex min-h-11 items-center rounded-md border border-gray-300 px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700 ${focusRing}`;

export { TierCard } from './TierCard';

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
  // After useDialog's own first-focus: start on the Name field.
  React.useEffect(() => {
    document.getElementById(`tier-name-${tier.key}`)?.focus();
  }, [tier.key]);
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
