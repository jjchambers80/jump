'use client';

// Create / edit one event add-on (spec 012, 037 D2). Shared by the event
// editor's Add-ons section and the setup wizard's Collect more step (050-K).
// Focus moves in on open, Tab stays inside, Escape closes and focus returns
// to the opener (useDialog).

import React, { FormEvent, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { formatPrice } from '@/lib/fees';
import { addOnAllInPrice, type AdminAddOn } from '@/lib/addOns';
import { useDialog } from '@/lib/useDialog';

export type AddOnScope = AdminAddOn['scope'];
export interface TierOption {
  id: string;
  name: string;
}

export interface DraftAddOn {
  id?: string;
  name: string;
  description: string;
  price: string;
  scope: AddOnScope;
  allTiers: boolean;
  priceTierIds: string[];
  quantityTotal: string;
  maxPerOrder: string;
  taxable: boolean;
}

const field = 'mt-1 block w-full min-h-11 sm:min-h-0 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';
const label = 'block text-sm font-medium text-gray-700 dark:text-slate-300';
const choice = 'flex min-h-11 items-center gap-2 text-sm text-gray-700 dark:text-slate-300 sm:min-h-0';

interface Props {
  draft: DraftAddOn;
  priceTiers: TierOption[];
  taxRate: number;
  taxInclusive: boolean;
  onSave: (draft: DraftAddOn) => Promise<void>;
  onCancel: () => void;
}

export default function AddOnDialog({ draft: initial, priceTiers, taxRate, taxInclusive, onSave, onCancel }: Props) {
  const [d, setD] = useState<DraftAddOn>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useDialog<HTMLFormElement>(true, onCancel);
  const set = <K extends keyof DraftAddOn>(key: K, value: DraftAddOn[K]) => setD((current) => ({ ...current, [key]: value }));

  const price = Number(d.price);
  const preview = useMemo(
    () => (Number.isFinite(price) && price >= 0 ? addOnAllInPrice({ price, taxable: d.taxable }, taxRate, taxInclusive) : null),
    [price, d.taxable, taxRate, taxInclusive]
  );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!d.name.trim()) return setError('Name is required');
    if (!Number.isFinite(price) || price < 0) return setError('Price must be 0 or more');
    if (!d.allTiers && d.scope !== 'APPLICATION' && d.priceTierIds.length === 0) {
      return setError('Pick at least one ticket tier, or offer it on all tiers');
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(d);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Could not save add-on');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="fixed inset-0 bg-black/50" aria-hidden onClick={onCancel} />
      <form
        ref={panelRef}
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-on-dialog-title"
        className="relative max-h-[90vh] w-full overflow-y-auto rounded-t-xl bg-white shadow-xl dark:bg-slate-800 sm:max-w-lg sm:rounded-lg"
        data-testid="add-on-dialog"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-2 dark:border-slate-700 dark:bg-slate-800 sm:px-6">
          <h3 id="add-on-dialog-title" className="text-lg font-semibold text-gray-900 dark:text-white">
            {d.id ? 'Edit add-on' : 'New add-on'}
          </h3>
          <button type="button" onClick={onCancel} className="inline-flex h-11 w-11 items-center justify-center rounded-md text-gray-600 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-700" aria-label="Close">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <div className="space-y-4 px-4 py-4 sm:px-6">
          {error && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{error}</p>}
          {d.id && (
            <p className="rounded-md bg-accent-50 px-3 py-2 text-xs text-accent-900 dark:bg-accent-950/50 dark:text-accent-200">
              Name, description, &ldquo;sold with&rdquo; and tax belong to the saved add-on and change on every event that offers it. Price, stock and tiers are this event&apos;s own.
            </p>
          )}
          <div>
            <label className={label} htmlFor="add-on-name">Name</label>
            <input id="add-on-name" className={field} value={d.name} onChange={(e) => set('name', e.target.value)} maxLength={80} required />
          </div>
          <div>
            <label className={label} htmlFor="add-on-description">Description</label>
            <textarea id="add-on-description" className={field} rows={2} value={d.description} onChange={(e) => set('description', e.target.value)} maxLength={500} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={label} htmlFor="add-on-price">Price ($)</label>
              <input id="add-on-price" type="number" min="0" step="0.01" className={field} value={d.price} onChange={(e) => set('price', e.target.value)} required aria-describedby={preview && d.scope !== 'APPLICATION' ? 'add-on-price-hint' : undefined} />
              {preview && d.scope !== 'APPLICATION' && (
                <p id="add-on-price-hint" className="mt-1 text-xs text-gray-600 dark:text-slate-400">
                  Ticket buyer pays {formatPrice(preview.total)}
                  {preview.fees > 0 && <> ({formatPrice(preview.fees)} fees{preview.tax > 0 && <>, {formatPrice(preview.tax)} tax</>})</>}
                </p>
              )}
            </div>
            <div>
              <label className={label} htmlFor="add-on-scope">Sold with</label>
              <select id="add-on-scope" className={field} value={d.scope} onChange={(e) => set('scope', e.target.value as AddOnScope)}>
                <option value="BOTH">Tickets &amp; applications</option>
                <option value="TICKET">Tickets only</option>
                <option value="APPLICATION">Applications only</option>
              </select>
            </div>
            <div>
              <label className={label} htmlFor="add-on-quantity">Total available</label>
              <input id="add-on-quantity" type="number" min="0" step="1" className={field} value={d.quantityTotal} onChange={(e) => set('quantityTotal', e.target.value)} placeholder="Unlimited" />
            </div>
            <div>
              <label className={label} htmlFor="add-on-max">Max per order</label>
              <input id="add-on-max" type="number" min="1" max="100" step="1" className={field} value={d.maxPerOrder} onChange={(e) => set('maxPerOrder', e.target.value)} placeholder="No limit" />
            </div>
          </div>

          <label className={choice}>
            <input type="checkbox" checked={d.taxable} onChange={(e) => set('taxable', e.target.checked)} />
            Taxable at the event&apos;s rate
          </label>

          {d.scope !== 'APPLICATION' && (
            <fieldset>
              <legend className={label}>Offer on</legend>
              <label className={`mt-1 ${choice}`}>
                <input type="radio" name="add-on-tiers" checked={d.allTiers} onChange={() => set('allTiers', true)} />
                All ticket tiers
              </label>
              <label className={`mt-1 ${choice}`}>
                <input type="radio" name="add-on-tiers" checked={!d.allTiers} onChange={() => set('allTiers', false)} />
                Only these tiers
              </label>
              {!d.allTiers && (
                <div className="ml-6 mt-2 space-y-1">
                  {priceTiers.length === 0 && <p className="text-xs text-gray-600 dark:text-slate-400">Save the event&apos;s tiers first.</p>}
                  {priceTiers.map((t) => (
                    <label key={t.id} className={choice}>
                      <input
                        type="checkbox"
                        checked={d.priceTierIds.includes(t.id)}
                        onChange={(e) => set('priceTierIds', e.target.checked ? [...d.priceTierIds, t.id] : d.priceTierIds.filter((id) => id !== t.id))}
                      />
                      {t.name}
                    </label>
                  ))}
                </div>
              )}
            </fieldset>
          )}
          {d.scope === 'BOTH' && !d.allTiers && (
            <p className="text-xs text-gray-600 dark:text-slate-400">Application tiers are attached from each form&apos;s tier settings.</p>
          )}
        </div>

        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-gray-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-800 sm:px-6">
          <button type="button" onClick={onCancel} className="min-h-11 rounded-md border border-gray-300 px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700 sm:min-h-0 sm:py-2">
            Cancel
          </button>
          <button type="submit" disabled={saving} className="min-h-11 rounded-md bg-accent-500 px-4 text-sm font-semibold text-gray-950 hover:bg-accent-hover disabled:opacity-50 sm:min-h-0 sm:py-2">
            {saving ? 'Saving…' : d.id ? 'Save' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
}
