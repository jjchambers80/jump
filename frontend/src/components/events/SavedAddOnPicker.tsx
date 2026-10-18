'use client';

// Saved add-on list (spec 037 D2, D9). An event's add-ons are offerings of
// the organization's saved add-ons (`AddOnProduct`). Every saved add-on not on
// the event yet is listed with an Add button (no dropdown to open), followed by
// the preset suggestions; "Create an add-on" opens the full dialog for a new
// one. Each saved add-on can be edited (name, description, default price,
// scope, taxable) or archived in place — there is no library page. Editing a
// saved add-on never changes an event's price.

import React, { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Archive, Pencil, Plus, Sparkles } from 'lucide-react';
import api from '@/services/api';
import { formatPrice } from '@/lib/fees';
import Flyout from '@/components/Flyout';
import { hintClass, inputClass, labelClass } from '@/components/events/EventFormLayout';

export type AddOnScope = 'TICKET' | 'APPLICATION' | 'BOTH';

export interface SavedAddOn {
  id: string;
  name: string;
  description: string | null;
  defaultPrice: number;
  scope: AddOnScope;
  taxable: boolean;
  isArchived: boolean;
  eventCount: number;
  /** The event's add-on id when this saved add-on is already on the event. */
  onEvent?: string | null;
}

interface Suggestion {
  key: string;
  name: string;
  description?: string | null;
  price: number;
  defaultPrice?: number;
  scope: AddOnScope;
  maxPerOrder?: number | null;
  taxable?: boolean;
}

interface ListResponse {
  savedAddOns: SavedAddOn[];
  suggestions: Suggestion[];
}

const SCOPE_LABEL: Record<AddOnScope, string> = { TICKET: 'Tickets', APPLICATION: 'Applications', BOTH: 'Tickets & applications' };

const iconButton = 'inline-flex h-11 w-11 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100 sm:h-8 sm:w-8';
const addButton = 'inline-flex min-h-11 shrink-0 items-center gap-1 rounded-md border border-gray-300 px-3 text-sm font-medium text-gray-800 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 disabled:opacity-60 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-700 sm:min-h-8';

export default function SavedAddOnPicker({
  orgId,
  eventId,
  reloadKey,
  onAttached,
  onCreateNew,
}: {
  orgId: string;
  eventId: string;
  /** Changes whenever the event's add-ons change, so the list re-reads which ones are on it. */
  reloadKey?: string;
  /** A saved add-on was attached to the event. */
  onAttached: () => void;
  /** Open the full add-on dialog for a new saved add-on. */
  onCreateNew: (name: string) => void;
}) {
  const createRef = useRef<HTMLButtonElement>(null);
  const [data, setData] = useState<ListResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<SavedAddOn | null>(null);

  const base = `/organizations/${orgId}/saved-add-ons`;
  const load = useCallback(async () => {
    try {
      setData(await api.get<ListResponse>(`${base}?${new URLSearchParams({ eventId })}`));
    } catch (err: any) {
      setError(err?.message || 'Could not load saved add-ons');
    }
  }, [base, eventId]);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  const saved = useMemo(() => (data?.savedAddOns ?? []).filter((s) => !s.onEvent), [data]);
  const suggestions = data?.suggestions ?? [];
  const nothingSaved = !!data && data.savedAddOns.length === 0;

  const attach = async (key: string, body: Record<string, unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await api.post(`/organizations/${orgId}/events/${eventId}/add-ons/attach`, body);
      onAttached();
    } catch (err: any) {
      setError(err?.message || 'Could not add it to this event');
    } finally {
      setBusy(null);
    }
  };

  const archive = async (item: SavedAddOn) => {
    if (!window.confirm(`Archive "${item.name}"? It leaves this list; events that already offer it keep it.`)) return;
    try {
      await api.post(`${base}/${item.id}/archive`, {});
      await load();
    } catch (err: any) {
      setError(err?.message || 'Could not archive it');
    }
  };

  const row = 'flex items-center gap-2 py-2';
  const name = 'block truncate text-sm font-medium text-gray-900 dark:text-white';
  const meta = 'block text-xs text-gray-500 dark:text-slate-400';

  return (
    <div className="mt-6 border-t border-gray-200 pt-4 dark:border-slate-700">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Add to this event</h3>
      {error && <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">{error}</p>}
      {!data && !error && <div aria-busy="true" aria-label="Loading saved add-ons" className="mt-2 h-11 animate-pulse rounded-md bg-gray-200 dark:bg-slate-700" />}

      {nothingSaved && (
        <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
          You have no add-ons set up yet.{' '}
          <button type="button" onClick={() => onCreateNew('')} className="font-medium text-accent-700 underline underline-offset-2 hover:text-accent-800 dark:text-accent-300">
            Create an add-on
          </button>
          {suggestions.length > 0 ? ' or start from a suggestion.' : '.'}
        </p>
      )}

      {data && (saved.length > 0 || suggestions.length > 0) && (
        <ul aria-label="Saved add-ons" className="mt-1 divide-y divide-gray-100 dark:divide-slate-800">
          {saved.map((item) => (
            <li key={item.id} className={row}>
              <span className="min-w-0 flex-1">
                <span className={name}>{item.name}</span>
                <span className={meta}>
                  {formatPrice(item.defaultPrice)} · {SCOPE_LABEL[item.scope]}
                  {item.eventCount ? ` · on ${item.eventCount} event${item.eventCount === 1 ? '' : 's'}` : ''}
                </span>
              </span>
              <button type="button" aria-label={`Edit saved add-on ${item.name}`} onClick={() => setEditing(item)} className={iconButton}>
                <Pencil className="h-3.5 w-3.5" aria-hidden />
              </button>
              <button type="button" aria-label={`Archive saved add-on ${item.name}`} onClick={() => archive(item)} className={`${iconButton} hover:text-red-600 dark:hover:text-red-400`}>
                <Archive className="h-3.5 w-3.5" aria-hidden />
              </button>
              <button
                type="button"
                aria-label={`Add ${item.name}`}
                disabled={busy !== null}
                onClick={() => attach(item.id, { productId: item.id })}
                className={addButton}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
                Add
              </button>
            </li>
          ))}
          {suggestions.map((s) => (
            <li key={`s-${s.key}`} className={row}>
              <Sparkles className="h-4 w-4 shrink-0 text-amber-500" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className={name}>{s.name}</span>
                <span className={meta}>Suggested · {formatPrice(s.price)}</span>
              </span>
              <button
                type="button"
                aria-label={`Add ${s.name}`}
                disabled={busy !== null}
                onClick={() =>
                  attach(`s-${s.key}`, {
                    savedAddOn: { name: s.name, description: s.description ?? null, defaultPrice: s.defaultPrice ?? s.price, scope: s.scope, taxable: s.taxable !== false },
                    ...(s.maxPerOrder ? { maxPerOrder: s.maxPerOrder } : {}),
                  })
                }
                className={addButton}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
                Add
              </button>
            </li>
          ))}
        </ul>
      )}

      {data && !nothingSaved && saved.length === 0 && suggestions.length === 0 && (
        <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">Every saved add-on is on this event.</p>
      )}

      {data && !nothingSaved && (
        <button ref={createRef} type="button" onClick={() => onCreateNew('')} className={`mt-2 ${addButton} border-dashed`}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Create an add-on
        </button>
      )}

      {editing && (
        <SavedAddOnFlyout
          orgId={orgId}
          item={editing}
          returnFocusRef={createRef}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
            onAttached();
          }}
        />
      )}
    </div>
  );
}

/** Edit a saved add-on: shared fields and the default price for new events. */
export function SavedAddOnFlyout({
  orgId,
  item,
  returnFocusRef,
  onClose,
  onSaved,
}: {
  orgId: string;
  item: SavedAddOn;
  returnFocusRef?: React.RefObject<HTMLElement>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const initial = useMemo(
    () => ({
      name: item.name,
      description: item.description ?? '',
      defaultPrice: String(item.defaultPrice),
      scope: item.scope,
      taxable: item.taxable,
    }),
    [item]
  );
  const [state, setState] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(state) !== JSON.stringify(initial);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const body: Record<string, unknown> = {};
    if (state.name !== initial.name) body.name = state.name.trim();
    if (state.description !== initial.description) body.description = state.description.trim() || null;
    if (state.defaultPrice !== initial.defaultPrice) body.defaultPrice = Number(state.defaultPrice);
    if (state.scope !== initial.scope) body.scope = state.scope;
    if (state.taxable !== initial.taxable) body.taxable = state.taxable;
    try {
      await api.patch(`/organizations/${orgId}/saved-add-ons/${item.id}`, body);
      onSaved();
    } catch (err: any) {
      setError(err?.message || 'Could not save it');
      setSaving(false);
    }
  };

  return (
    <Flyout
      title={`Edit ${item.name}`}
      description={
        item.eventCount > 0
          ? `Name, description, scope and tax apply to all ${item.eventCount} event${item.eventCount === 1 ? '' : 's'} that offer it. Prices on those events stay as they are.`
          : 'Saved for reuse on any event.'
      }
      dirty={dirty}
      saving={saving}
      saveDisabled={!state.name.trim() || state.defaultPrice === '' || Number(state.defaultPrice) < 0}
      error={error}
      returnFocusRef={returnFocusRef}
      onClose={onClose}
      onSubmit={submit}
    >
      <div className="space-y-4">
        <div>
          <label htmlFor="saved-add-on-name" className={labelClass}>Name</label>
          <input id="saved-add-on-name" required maxLength={80} value={state.name} onChange={(e) => setState((s) => ({ ...s, name: e.target.value }))} className={inputClass} />
        </div>
        <div>
          <label htmlFor="saved-add-on-description" className={labelClass}>Description</label>
          <textarea id="saved-add-on-description" rows={2} maxLength={500} value={state.description} onChange={(e) => setState((s) => ({ ...s, description: e.target.value }))} className={inputClass} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="saved-add-on-price" className={labelClass}>Default price ($)</label>
            <input id="saved-add-on-price" type="number" min="0" step="0.01" required value={state.defaultPrice} onChange={(e) => setState((s) => ({ ...s, defaultPrice: e.target.value }))} className={inputClass} />
            <p className={hintClass}>Used when it is added to an event.</p>
          </div>
          <div>
            <label htmlFor="saved-add-on-scope" className={labelClass}>Sold with</label>
            <select id="saved-add-on-scope" value={state.scope} onChange={(e) => setState((s) => ({ ...s, scope: e.target.value as AddOnScope }))} className={inputClass}>
              <option value="BOTH">Tickets &amp; applications</option>
              <option value="TICKET">Tickets only</option>
              <option value="APPLICATION">Applications only</option>
            </select>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-300">
          <input type="checkbox" checked={state.taxable} onChange={(e) => setState((s) => ({ ...s, taxable: e.target.checked }))} className="h-4 w-4 accent-accent-600" />
          Taxable at the event&apos;s rate
        </label>
      </div>
    </Flyout>
  );
}
