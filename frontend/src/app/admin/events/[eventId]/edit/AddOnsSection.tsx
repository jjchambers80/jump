'use client';

// Admin › Event › Edit › Add-ons (spec 012). Self-contained: loads, creates,
// edits, activates and reorders through the add-ons API as the organizer
// works, independent of the surrounding event form's Save button.

import React, { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import api from '@/services/api';
import { formatPrice } from '@/lib/fees';
import { addOnAllInPrice, type AdminAddOn } from '@/lib/addOns';

type Scope = AdminAddOn['scope'];

interface TierOption {
  id: string;
  name: string;
}

interface Preset {
  key: string;
  name: string;
  description?: string;
  price: number;
  scope: Scope;
  maxPerOrder?: number;
  taxable?: boolean;
}

interface AddOnsSectionProps {
  orgId: string;
  eventId: string;
  priceTiers: TierOption[];
  taxRate: number;
  taxInclusive: boolean;
}

interface DraftAddOn {
  id?: string;
  name: string;
  description: string;
  price: string;
  scope: Scope;
  allTiers: boolean;
  priceTierIds: string[];
  quantityTotal: string;
  maxPerOrder: string;
  taxable: boolean;
}

const SCOPE_LABEL: Record<Scope, string> = { TICKET: 'Tickets', APPLICATION: 'Applications', BOTH: 'Tickets & applications' };
const field = 'mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';
const label = 'block text-sm font-medium text-gray-700 dark:text-slate-300';

const emptyDraft = (): DraftAddOn => ({
  name: '',
  description: '',
  price: '',
  scope: 'BOTH',
  allTiers: true,
  priceTierIds: [],
  quantityTotal: '',
  maxPerOrder: '',
  taxable: true,
});

function describeError(err: unknown, fallback: string) {
  return err instanceof Error && err.message ? err.message : fallback;
}

export default function AddOnsSection({ orgId, eventId, priceTiers, taxRate, taxInclusive }: AddOnsSectionProps) {
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const canEdit = role === 'ADMIN' || role === 'SYSTEM_ADMIN';
  const base = `/organizations/${orgId}/events/${eventId}/add-ons`;

  const [addOns, setAddOns] = useState<AdminAddOn[] | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showPresetMenu, setShowPresetMenu] = useState(false);
  const [draft, setDraft] = useState<DraftAddOn | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.get<{ addOns: AdminAddOn[] }>(base);
      setAddOns(data.addOns);
      setError(null);
    } catch (err) {
      setError(describeError(err, 'Could not load add-ons'));
    }
  }, [base]);

  useEffect(() => {
    load();
    api
      .get<{ presets: Preset[] }>(`${base}/presets`)
      .then((data) => setPresets(data.presets))
      .catch(() => setPresets([]));
  }, [base, load]);

  const openNew = (preset?: Preset) => {
    setShowPresetMenu(false);
    setDraft({
      ...emptyDraft(),
      ...(preset && {
        name: preset.name,
        description: preset.description ?? '',
        price: String(preset.price),
        scope: preset.scope,
        maxPerOrder: preset.maxPerOrder ? String(preset.maxPerOrder) : '',
        taxable: preset.taxable !== false,
      }),
    });
  };

  const openEdit = (a: AdminAddOn) =>
    setDraft({
      id: a.id,
      name: a.name,
      description: a.description ?? '',
      price: String(a.price),
      scope: a.scope,
      allTiers: a.allTiers,
      priceTierIds: a.priceTierIds ?? [],
      quantityTotal: a.quantityTotal == null ? '' : String(a.quantityTotal),
      maxPerOrder: a.maxPerOrder == null ? '' : String(a.maxPerOrder),
      taxable: a.taxable,
    });

  const setActive = async (a: AdminAddOn, isActive: boolean) => {
    setBusyId(a.id);
    try {
      await api.post(`${base}/${a.id}/${isActive ? 'activate' : 'deactivate'}`, {});
      await load();
    } catch (err) {
      setError(describeError(err, 'Could not update add-on'));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (a: AdminAddOn) => {
    if (!confirm(`Delete "${a.name}"?`)) return;
    setBusyId(a.id);
    try {
      await api.delete(`${base}/${a.id}`);
      await load();
    } catch (err) {
      setError(describeError(err, 'Could not delete add-on'));
    } finally {
      setBusyId(null);
    }
  };

  const move = async (index: number, dir: -1 | 1) => {
    if (!addOns) return;
    const target = index + dir;
    if (target < 0 || target >= addOns.length) return;
    const ids = addOns.map((a) => a.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    setBusyId(ids[target]);
    try {
      const data = await api.post<{ addOns: AdminAddOn[] }>(`${base}/reorder`, { addOnIds: ids });
      setAddOns(data.addOns);
    } catch (err) {
      setError(describeError(err, 'Could not reorder add-ons'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div data-testid="add-ons-section">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Add-ons</h2>
          <p className="text-xs text-gray-500 dark:text-slate-400">
            Extras sold with tickets or applications — parking, power, badges. Saved immediately.
          </p>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            {presets.length > 0 && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowPresetMenu(!showPresetMenu)}
                  className="rounded-md border border-indigo-300 dark:border-indigo-700 px-3 py-1.5 text-xs font-medium text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/20"
                >
                  Add from Preset
                </button>
                {showPresetMenu && (
                  <div className="absolute right-0 z-10 mt-1 w-60 rounded-md border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 shadow-lg">
                    {presets.map((preset) => (
                      <button
                        key={preset.key}
                        type="button"
                        onClick={() => openNew(preset)}
                        className="block w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700"
                      >
                        <span className="font-medium">{preset.name}</span>
                        <span className="ml-2 text-gray-400 dark:text-slate-500">{formatPrice(preset.price)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <button
              type="button"
              onClick={() => openNew()}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-indigo-500"
            >
              + Add Add-on
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="mb-3 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {addOns && addOns.length === 0 && (
        <p className="text-sm text-gray-500 dark:text-slate-400 py-4 text-center">
          No add-ons yet. {canEdit ? 'Add one, or start from a preset.' : ''}
        </p>
      )}

      <div className="space-y-2">
        {(addOns ?? []).map((a, index) => {
          const remaining = a.quantityTotal == null ? null : a.quantityTotal - a.quantitySold - a.quantityReserved;
          const allIn = addOnAllInPrice(a, taxRate, taxInclusive);
          return (
            <div
              key={a.id}
              data-testid={`admin-add-on-${a.id}`}
              className={`flex items-start justify-between gap-4 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 ${a.isActive ? '' : 'opacity-60'}`}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-gray-900 dark:text-white">{a.name}</p>
                  <span className="rounded-full bg-gray-100 dark:bg-slate-700 px-2 py-0.5 text-xs text-gray-600 dark:text-slate-300">{SCOPE_LABEL[a.scope]}</span>
                  {!a.isActive && <span className="rounded-full bg-amber-100 dark:bg-amber-900/30 px-2 py-0.5 text-xs text-amber-800 dark:text-amber-300">Inactive</span>}
                  {!a.taxable && <span className="text-xs text-gray-400 dark:text-slate-500">untaxed</span>}
                </div>
                <p className="text-sm text-gray-600 dark:text-slate-300 mt-0.5">
                  {formatPrice(a.price)}
                  {a.scope !== 'APPLICATION' && <span className="text-gray-400 dark:text-slate-500"> · buyer pays {formatPrice(allIn.total)} with tickets</span>}
                  {a.maxPerOrder && <span className="text-gray-400 dark:text-slate-500"> · max {a.maxPerOrder} per order</span>}
                </p>
                <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                  Sold {a.quantitySold}
                  {a.quantityReserved > 0 && <> · reserved {a.quantityReserved}</>}
                  {remaining !== null ? <> · {remaining} left of {a.quantityTotal}</> : <> · unlimited</>}
                  {' · '}
                  {a.allTiers
                    ? 'all tiers'
                    : a.priceTierIds.length > 0
                      ? `tiers: ${a.priceTierIds.map((id) => priceTiers.find((t) => t.id === id)?.name ?? '?').join(', ')}`
                      : 'no ticket tiers attached'}
                </p>
              </div>
              {canEdit && (
                <div className="flex items-center gap-1 shrink-0">
                  <button type="button" onClick={() => move(index, -1)} disabled={index === 0 || busyId !== null} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-slate-200 disabled:opacity-30" aria-label={`Move ${a.name} up`}>↑</button>
                  <button type="button" onClick={() => move(index, 1)} disabled={index === addOns!.length - 1 || busyId !== null} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-slate-200 disabled:opacity-30" aria-label={`Move ${a.name} down`}>↓</button>
                  <button type="button" onClick={() => openEdit(a)} className="px-2 py-1 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded">Edit</button>
                  <button type="button" onClick={() => setActive(a, !a.isActive)} disabled={busyId === a.id} className="px-2 py-1 text-xs font-medium text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700 rounded">
                    {a.isActive ? 'Deactivate' : 'Activate'}
                  </button>
                  {a.orderLineCount === 0 && (
                    <button type="button" onClick={() => remove(a)} disabled={busyId === a.id} className="px-2 py-1 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded">Delete</button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {draft && (
        <AddOnDialog
          draft={draft}
          priceTiers={priceTiers}
          taxRate={taxRate}
          taxInclusive={taxInclusive}
          onCancel={() => setDraft(null)}
          onSave={async (d) => {
            const body = {
              name: d.name.trim(),
              description: d.description.trim() || null,
              price: Number(d.price),
              scope: d.scope,
              allTiers: d.allTiers,
              priceTierIds: d.allTiers ? [] : d.priceTierIds,
              quantityTotal: d.quantityTotal.trim() === '' ? null : Number(d.quantityTotal),
              maxPerOrder: d.maxPerOrder.trim() === '' ? null : Number(d.maxPerOrder),
              taxable: d.taxable,
            };
            if (d.id) await api.patch(`${base}/${d.id}`, body);
            else await api.post(base, body);
            setDraft(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

interface AddOnDialogProps {
  draft: DraftAddOn;
  priceTiers: TierOption[];
  taxRate: number;
  taxInclusive: boolean;
  onSave: (draft: DraftAddOn) => Promise<void>;
  onCancel: () => void;
}

function AddOnDialog({ draft: initial, priceTiers, taxRate, taxInclusive, onSave, onCancel }: AddOnDialogProps) {
  const [d, setD] = useState<DraftAddOn>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
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
      setError(describeError(err, 'Could not save add-on'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      onClick={(e) => { if (e.target === overlayRef.current) onCancel(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-on-dialog-title"
    >
      <div className="fixed inset-0 bg-black/50" />
      <form
        onSubmit={submit}
        className="relative bg-white dark:bg-slate-800 w-full sm:max-w-lg sm:rounded-lg rounded-t-xl max-h-[90vh] overflow-y-auto shadow-xl"
        data-testid="add-on-dialog"
      >
        <div className="sticky top-0 bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700 px-6 py-4 flex items-center justify-between z-10">
          <h3 id="add-on-dialog-title" className="text-lg font-semibold text-gray-900 dark:text-white">
            {d.id ? 'Edit add-on' : 'New add-on'}
          </h3>
          <button type="button" onClick={onCancel} className="text-gray-400 hover:text-gray-600 dark:hover:text-slate-300" aria-label="Close">✕</button>
        </div>

        <div className="px-6 py-4 space-y-4">
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          <div>
            <label className={label} htmlFor="add-on-name">Name</label>
            <input id="add-on-name" className={field} value={d.name} onChange={(e) => set('name', e.target.value)} maxLength={80} required />
          </div>
          <div>
            <label className={label} htmlFor="add-on-description">Description</label>
            <textarea id="add-on-description" className={field} rows={2} value={d.description} onChange={(e) => set('description', e.target.value)} maxLength={500} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={label} htmlFor="add-on-price">Price ($)</label>
              <input id="add-on-price" type="number" min="0" step="0.01" className={field} value={d.price} onChange={(e) => set('price', e.target.value)} required />
              {preview && d.scope !== 'APPLICATION' && (
                <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                  Ticket buyer pays {formatPrice(preview.total)}
                  {preview.fees > 0 && <> ({formatPrice(preview.fees)} fees{preview.tax > 0 && <>, {formatPrice(preview.tax)} tax</>})</>}
                </p>
              )}
            </div>
            <div>
              <label className={label} htmlFor="add-on-scope">Sold with</label>
              <select id="add-on-scope" className={field} value={d.scope} onChange={(e) => set('scope', e.target.value as Scope)}>
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

          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-300">
            <input type="checkbox" checked={d.taxable} onChange={(e) => set('taxable', e.target.checked)} />
            Taxable at the event&apos;s rate
          </label>

          {d.scope !== 'APPLICATION' && (
            <fieldset>
              <legend className={label}>Offer on</legend>
              <label className="mt-1 flex items-center gap-2 text-sm text-gray-700 dark:text-slate-300">
                <input type="radio" name="add-on-tiers" checked={d.allTiers} onChange={() => set('allTiers', true)} />
                All ticket tiers
              </label>
              <label className="mt-1 flex items-center gap-2 text-sm text-gray-700 dark:text-slate-300">
                <input type="radio" name="add-on-tiers" checked={!d.allTiers} onChange={() => set('allTiers', false)} />
                Only these tiers
              </label>
              {!d.allTiers && (
                <div className="mt-2 ml-6 space-y-1">
                  {priceTiers.length === 0 && <p className="text-xs text-gray-500 dark:text-slate-400">Save the event&apos;s tiers first.</p>}
                  {priceTiers.map((t) => (
                    <label key={t.id} className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-300">
                      <input
                        type="checkbox"
                        checked={d.priceTierIds.includes(t.id)}
                        onChange={(e) =>
                          set('priceTierIds', e.target.checked ? [...d.priceTierIds, t.id] : d.priceTierIds.filter((id) => id !== t.id))
                        }
                      />
                      {t.name}
                    </label>
                  ))}
                </div>
              )}
            </fieldset>
          )}
          {d.scope === 'BOTH' && !d.allTiers && (
            <p className="text-xs text-gray-500 dark:text-slate-400">Application tiers are attached from each form&apos;s tier settings.</p>
          )}
        </div>

        <div className="sticky bottom-0 bg-white dark:bg-slate-800 border-t border-gray-200 dark:border-slate-700 px-6 py-3 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-md border border-gray-300 dark:border-slate-600 px-4 py-2 text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700">
            Cancel
          </button>
          <button type="submit" disabled={saving} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50">
            {saving ? 'Saving…' : d.id ? 'Save' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
}
