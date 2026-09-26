'use client';

// Saved add-on picker (spec 037 D2, D9). An event's add-ons are offerings of
// the organization's saved add-ons (`AddOnProduct`). The picker searches the
// saved ones first; "Create '<typed name>'" appears only when nothing matches
// the name case-insensitively, so the same add-on is never saved twice. Each
// option can be edited (name, description, default price, scope, taxable) or
// archived in place — there is no library page. Editing a saved add-on never
// changes an event's price.

import React, { FormEvent, KeyboardEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Archive, Pencil, Plus, Search, Sparkles } from 'lucide-react';
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
  exactMatch?: SavedAddOn | null;
  canCreate?: boolean;
}

type Option =
  | { kind: 'saved'; item: SavedAddOn }
  | { kind: 'suggestion'; item: Suggestion }
  | { kind: 'create'; name: string };

const SCOPE_LABEL: Record<AddOnScope, string> = { TICKET: 'Tickets', APPLICATION: 'Applications', BOTH: 'Tickets & applications' };

export default function SavedAddOnPicker({
  orgId,
  eventId,
  onAttached,
  onCreateNew,
}: {
  orgId: string;
  eventId: string;
  /** A saved add-on was attached to the event. */
  onAttached: () => void;
  /** Nothing matched: open the full add-on dialog for a new saved add-on with this name. */
  onCreateNew: (name: string) => void;
}) {
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<ListResponse | null>(null);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<SavedAddOn | null>(null);

  const base = `/organizations/${orgId}/saved-add-ons`;
  const load = useCallback(
    async (q: string) => {
      const params = new URLSearchParams({ eventId });
      if (q.trim()) params.set('q', q.trim());
      try {
        setData(await api.get<ListResponse>(`${base}?${params}`));
      } catch (err: any) {
        setError(err?.message || 'Could not load saved add-ons');
      }
    },
    [base, eventId]
  );

  // Debounced search while open.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => load(query), 180);
    return () => clearTimeout(t);
  }, [open, query, load]);

  const options: Option[] = useMemo(() => {
    if (!data) return [];
    const saved = data.savedAddOns.map((item) => ({ kind: 'saved' as const, item }));
    const typed = query.trim();
    const suggestions = typed ? [] : data.suggestions.map((item) => ({ kind: 'suggestion' as const, item }));
    const create =
      typed && (data.canCreate ?? !data.savedAddOns.some((s) => s.name.toLowerCase() === typed.toLowerCase()))
        ? [{ kind: 'create' as const, name: typed }]
        : [];
    return [...saved, ...suggestions, ...create];
  }, [data, query]);

  useEffect(() => setActive(0), [options.length]);

  const close = () => {
    setOpen(false);
    setError(null);
  };

  const attach = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/organizations/${orgId}/events/${eventId}/add-ons/attach`, body);
      setQuery('');
      close();
      onAttached();
    } catch (err: any) {
      setError(err?.message || 'Could not add it to this event');
    } finally {
      setBusy(false);
    }
  };

  const choose = (option: Option | undefined) => {
    if (!option || busy) return;
    if (option.kind === 'saved') {
      if (option.item.onEvent) return;
      attach({ productId: option.item.id });
    } else if (option.kind === 'suggestion') {
      const s = option.item;
      attach({
        savedAddOn: { name: s.name, description: s.description ?? null, defaultPrice: s.defaultPrice ?? s.price, scope: s.scope, taxable: s.taxable !== false },
        ...(s.maxPerOrder ? { maxPerOrder: s.maxPerOrder } : {}),
      });
    } else {
      close();
      onCreateNew(option.name);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, Math.max(options.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && open) {
      e.preventDefault();
      choose(options[active]);
    } else if (e.key === 'Escape') {
      close();
    }
  };

  const archive = async (item: SavedAddOn) => {
    if (!window.confirm(`Archive "${item.name}"? It leaves this list; events that already offer it keep it.`)) return;
    try {
      await api.post(`${base}/${item.id}/archive`, {});
      await load(query);
    } catch (err: any) {
      setError(err?.message || 'Could not archive it');
    }
  };

  const optionId = (i: number) => `${listboxId}-opt-${i}`;

  return (
    <div className="relative w-full sm:w-80">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
        <input
          ref={inputRef}
          role="combobox"
          aria-label="Add an add-on"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={open && options[active] ? optionId(active) : undefined}
          value={query}
          placeholder="Add an add-on — search or type a name"
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => !editing && setOpen(false), 150)}
          onKeyDown={onKey}
          className="block w-full rounded-md border border-gray-300 bg-white py-2 pl-8 pr-3 text-sm text-gray-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
        />
      </div>

      {open && (
        <div className="absolute right-0 z-30 mt-1 w-full min-w-[20rem] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl dark:border-slate-600 dark:bg-slate-800">
          {error && <p role="alert" className="border-b border-gray-100 px-3 py-2 text-xs text-red-700 dark:border-slate-700 dark:text-red-300">{error}</p>}
          <ul id={listboxId} role="listbox" aria-label="Saved add-ons" className="max-h-80 overflow-y-auto py-1">
            {!data && <li className="px-3 py-2 text-sm text-gray-500 dark:text-slate-400">Loading…</li>}
            {data && options.length === 0 && (
              <li className="px-3 py-2 text-sm text-gray-500 dark:text-slate-400">No saved add-ons yet. Type a name to create one.</li>
            )}
            {options.map((option, i) => {
              const selected = i === active;
              const row = `flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${selected ? 'bg-indigo-50 dark:bg-indigo-950/50' : ''}`;
              if (option.kind === 'saved') {
                const item = option.item;
                const already = !!item.onEvent;
                return (
                  <li
                    key={item.id}
                    id={optionId(i)}
                    role="option"
                    aria-selected={selected}
                    aria-disabled={already}
                    className={`${row} ${already ? 'opacity-60' : 'cursor-pointer'}`}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      choose(option);
                    }}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-gray-900 dark:text-white">{item.name}</span>
                      <span className="block text-xs text-gray-500 dark:text-slate-400">
                        {formatPrice(item.defaultPrice)} · {SCOPE_LABEL[item.scope]}
                        {already ? ' · on this event' : item.eventCount ? ` · on ${item.eventCount} event${item.eventCount === 1 ? '' : 's'}` : ''}
                      </span>
                    </span>
                    <button
                      type="button"
                      aria-label={`Edit saved add-on ${item.name}`}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setEditing(item);
                      }}
                      className="rounded p-1.5 text-gray-400 hover:bg-white hover:text-gray-700 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden />
                    </button>
                    <button
                      type="button"
                      aria-label={`Archive saved add-on ${item.name}`}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        archive(item);
                      }}
                      className="rounded p-1.5 text-gray-400 hover:bg-white hover:text-red-600 dark:hover:bg-slate-700 dark:hover:text-red-400"
                    >
                      <Archive className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </li>
                );
              }
              if (option.kind === 'suggestion') {
                return (
                  <li
                    key={`s-${option.item.key}`}
                    id={optionId(i)}
                    role="option"
                    aria-selected={selected}
                    className={`${row} cursor-pointer`}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      choose(option);
                    }}
                  >
                    <Sparkles className="h-4 w-4 shrink-0 text-amber-500" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-gray-900 dark:text-white">{option.item.name}</span>
                      <span className="block text-xs text-gray-500 dark:text-slate-400">Suggested · {formatPrice(option.item.price)}</span>
                    </span>
                  </li>
                );
              }
              return (
                <li
                  key="create"
                  id={optionId(i)}
                  role="option"
                  aria-selected={selected}
                  className={`${row} cursor-pointer border-t border-gray-100 font-medium text-indigo-700 dark:border-slate-700 dark:text-indigo-300`}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(option);
                  }}
                >
                  <Plus className="h-4 w-4 shrink-0" aria-hidden />
                  Create &ldquo;{option.name}&rdquo;
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {editing && (
        <SavedAddOnFlyout
          orgId={orgId}
          item={editing}
          returnFocusRef={inputRef}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load(query);
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
          <input type="checkbox" checked={state.taxable} onChange={(e) => setState((s) => ({ ...s, taxable: e.target.checked }))} className="h-4 w-4 accent-indigo-600" />
          Taxable at the event&apos;s rate
        </label>
      </div>
    </Flyout>
  );
}
