'use client';

// Event add-ons (spec 012). Self-contained: loads, creates, edits, activates
// and reorders through the add-ons API as the organizer works, independent of
// any surrounding Save button. Mounted by the event editor's Sales section and
// the setup wizard's Collect more step (050-K), which passes `onChange` to
// refresh its preview after every save.
// Spec 037 D2/D9: add-ons come from the organization's saved add-ons through
// `SavedAddOnPicker`; "Create '<name>'" opens AddOnDialog, which saves a new
// saved add-on and its offering here in one call. Price stays per event.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import api from '@/services/api';
import type { AdminAddOn } from '@/lib/addOns';
import SavedAddOnPicker from '@/components/events/SavedAddOnPicker';
import { useCan } from '@/components/OrgContext';
import AddOnDialog from './AddOnDialog';
import { draftBody, emptyDraft, toDraft, type DraftAddOn, type TierOption } from './addOnDraft';
import AddOnRow from './AddOnRow';

interface AddOnsSectionProps {
  orgId: string;
  eventId: string;
  priceTiers: TierOption[];
  taxRate: number;
  taxInclusive: boolean;
  /** Section number on the edit page's run sheet (decorative). */
  step?: number;
  /** Called with the reloaded list after every successful change (create, attach, edit, reorder, …). */
  onChange?: (addOns: AdminAddOn[]) => void;
}

// services/api.ts throws plain `{ status, message }` objects, not Errors.
const describeError = (err: unknown, fallback: string) => (err as { message?: string } | null)?.message || fallback;

export default function AddOnsSection({ orgId, eventId, priceTiers, taxRate, taxInclusive, step, onChange }: AddOnsSectionProps) {
  const canEdit = useCan('addOns.manage');
  const base = `/organizations/${orgId}/events/${eventId}/add-ons`;

  const [addOns, setAddOns] = useState<AdminAddOn[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftAddOn | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.get<{ addOns: AdminAddOn[] }>(base);
      setAddOns(data.addOns);
      setLoadError(null);
      return data.addOns;
    } catch (err) {
      setLoadError(describeError(err, 'Could not load add-ons'));
      return null;
    }
  }, [base]);

  useEffect(() => {
    load();
  }, [load]);

  const headingRef = useRef<HTMLHeadingElement>(null);
  /** After any successful change: reload, drop a stale row error, tell the host. */
  const changed = async () => {
    setError(null);
    const list = await load();
    if (list) onChange?.(list);
  };

  /** One row action: busy while it runs, the message on failure. */
  const run = async (id: string, fallback: string, call: () => Promise<unknown>) => {
    setBusyId(id);
    setError(null);
    try {
      await call();
      await changed();
      return true;
    } catch (err) {
      setError(describeError(err, fallback));
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const move = (index: number, dir: -1 | 1) => {
    if (!addOns) return;
    const ids = addOns.map((a) => a.id);
    [ids[index], ids[index + dir]] = [ids[index + dir], ids[index]];
    return run(ids[index + dir], 'Could not reorder add-ons', () => api.post(`${base}/reorder`, { addOnIds: ids }));
  };

  return (
    <div data-testid="add-ons-section">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 basis-64 items-baseline gap-3">
          {step != null && (
            <span aria-hidden className="font-mono text-xs font-medium tabular-nums text-gray-500 dark:text-slate-400">
              {String(step).padStart(2, '0')}
            </span>
          )}
          <div className="min-w-0">
            <h2 ref={headingRef} tabIndex={-1} className="text-lg font-semibold tracking-tight text-gray-900 focus:outline-none dark:text-white">Add-ons</h2>
            <p className="text-xs text-gray-600 dark:text-slate-400">
              Extras sold with tickets or applications — parking, power, badges. Saved immediately.
            </p>
          </div>
        </div>
        {canEdit && (
          <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto">
            <SavedAddOnPicker orgId={orgId} eventId={eventId} onAttached={changed} onCreateNew={(name) => setDraft(emptyDraft(name))} />
          </div>
        )}
      </div>

      {(error || loadError) && (
        <div role="alert" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
          <span>{error ?? loadError}</span>
          {loadError && (
            <button type="button" onClick={load} className="min-h-11 rounded-md border border-red-300 px-3 font-medium hover:bg-red-100 dark:border-red-700 dark:hover:bg-red-900/40 sm:min-h-8">
              Try again
            </button>
          )}
        </div>
      )}

      {!addOns && !loadError && (
        <div aria-busy="true" aria-label="Loading add-ons" className="space-y-2">
          {[0, 1].map((i) => <div key={i} className="h-20 animate-pulse rounded-lg bg-gray-200 dark:bg-slate-700" />)}
        </div>
      )}

      {addOns && addOns.length === 0 && (
        <p className="py-4 text-center text-sm text-gray-600 dark:text-slate-400">
          No add-ons yet. {canEdit ? 'Search your saved add-ons above, or type a new name.' : ''}
        </p>
      )}

      {addOns && addOns.length > 0 && (
        <ul className="space-y-2" aria-label="Add-ons on this event">
          {addOns.map((a, index) => (
            <AddOnRow
              key={a.id}
              addOn={a}
              priceTiers={priceTiers}
              taxRate={taxRate}
              taxInclusive={taxInclusive}
              canEdit={canEdit}
              first={index === 0}
              last={index === addOns.length - 1}
              busy={busyId !== null}
              onMove={(dir) => move(index, dir)}
              onEdit={() => setDraft(toDraft(a))}
              onToggleActive={() => run(a.id, 'Could not update add-on', () => api.post(`${base}/${a.id}/${a.isActive ? 'deactivate' : 'activate'}`, {}))}
              onRemove={async () => {
                if (!confirm(`Delete "${a.name}"?`)) return;
                // Its row (and this button) is gone: focus the list heading.
                if (await run(a.id, 'Could not delete add-on', () => api.delete(`${base}/${a.id}`))) headingRef.current?.focus();
              }}
            />
          ))}
        </ul>
      )}

      {draft && (
        <AddOnDialog
          draft={draft}
          priceTiers={priceTiers}
          taxRate={taxRate}
          taxInclusive={taxInclusive}
          onCancel={() => setDraft(null)}
          onSave={async (d) => {
            const body = draftBody(d);
            if (d.id) await api.patch(`${base}/${d.id}`, body);
            else await api.post(base, body);
            setDraft(null);
            await changed();
          }}
        />
      )}
    </div>
  );
}
