'use client';

// The ticket tiers of the Tickets step: the event editor's TierCard and
// TierEditDialog over the price-tier routes (useTierActions). Each card shows
// the all-in price buyers pay (lib/fees.ts, gotcha 12). `&tier=<id>` opens that
// tier's dialog (spec 050 §3: a tier's Edit on the Details page lands here);
// closing it drops the parameter and returns focus to the tier's Edit button.

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus, Ticket } from 'lucide-react';
import api from '@/services/api';
import { TierCard, TierEditDialog, type TierFormData } from '@/components/TierEditDialog';
import TierPresetMenu, { type TierPreset } from '@/components/events/TierPresetMenu';
import { tierAccent } from '@/components/events/EventEditSummary';
import { newTierForm, tierFromPreset, tierToForm, type TierFormInput } from '@/components/events/tierForm';
import { computeTierAllInPrice, formatPrice } from '@/lib/fees';
import { SALES_FIELD_IDS } from '../contentSteps';
import { errorText, secondaryButton } from '../ui';
import { useTierActions } from './useTierActions';
import type { SavedRowProps } from './types';

const editId = (key: string) => `setup-tier-edit-${key}`;
const ADD_ID = SALES_FIELD_IDS.tierAdd;

export default function TierList(props: SavedRowProps & { readOnly?: boolean; errors?: Record<string, string> }) {
  const { orgId, saved, zone } = props;
  const addError = props.errors?.[ADD_ID];
  const actions = useTierActions(props);
  const { tiers } = actions;
  const router = useRouter();
  const params = useSearchParams();
  const [presets, setPresets] = useState<TierPreset[]>([]);
  const [editing, setEditing] = useState<{ form: TierFormInput; index: number } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const deepLinked = useRef(false);

  useEffect(() => {
    api
      .get<{ tierPresets: TierPreset[] }>(`/organizations/${orgId}/tier-presets`)
      .then((data) => setPresets(data.tierPresets))
      // Saved tiers are a shortcut; the list works without them.
      .catch(() => undefined);
  }, [orgId]);

  const setTierParam = (id: string | null) => {
    const next = new URLSearchParams(window.location.search);
    if (id) next.set('tier', id);
    else next.delete('tier');
    router.replace(`${window.location.pathname}?${next.toString()}`, { scroll: false });
  };

  // Deep link: open the named tier once the list is there.
  useEffect(() => {
    const id = params.get('tier');
    if (deepLinked.current || !id) return;
    const index = tiers.findIndex((t) => t.id === id);
    if (index < 0) return;
    deepLinked.current = true;
    setEditing({ form: tierToForm(tiers[index], zone), index });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, tiers]);

  const open = (form: TierFormInput, index: number) => {
    setErrors([]);
    setEditing({ form, index });
    if (!form.isNew) setTierParam(form.key);
  };

  const close = () => {
    const key = editing?.form.key;
    setEditing(null);
    setErrors([]);
    if (params.get('tier')) setTierParam(null);
    // useDialog returns focus to the opener; a deep link or a preset pick has none left.
    requestAnimationFrame(() => {
      if (document.activeElement && document.activeElement !== document.body) return;
      (document.getElementById(key ? editId(key) : ADD_ID) ?? document.getElementById(ADD_ID))?.focus();
    });
  };

  const save = async (draft: TierFormData) => {
    if (!editing) return;
    setBusy(true);
    const problems = await actions.save({ ...editing.form, ...draft });
    setBusy(false);
    if (problems.length) setErrors(problems);
    else close();
  };

  const allIn = (price: number) => {
    if (!(price > 0)) return undefined;
    const { total } = computeTierAllInPrice(price, saved.tax?.rate ?? 0, saved.taxInclusive === true);
    return `Buyers pay ${formatPrice(total)} with fees${saved.tax?.rate ? ' and tax' : ''}`;
  };

  return (
    <section aria-labelledby="setup-tiers-heading" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="setup-tiers-heading" className="text-base font-semibold text-gray-900 dark:text-white">
          Ticket tiers
        </h2>
        <TierPresetMenu orgId={orgId} presets={presets} onPresetsChange={setPresets} onPick={(preset) => open(tierFromPreset(preset), tiers.length)} />
      </div>

      {tiers.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 p-6 text-center dark:border-slate-600">
          <Ticket className="mx-auto h-6 w-6 text-gray-500 dark:text-slate-400" aria-hidden />
          <p className="mt-2 text-sm text-gray-700 dark:text-slate-300">No tiers yet. Add one, like General Admission, so buyers can choose a ticket.</p>
        </div>
      ) : (
        <ul className="space-y-2" aria-label="Ticket tiers">
          {tiers.map((tier, index) => {
            const form = tierToForm(tier, zone);
            const used = (tier.quantitySold ?? 0) + (tier.quantityReserved ?? 0) > 0;
            return (
              <li key={tier.id}>
                <TierCard
                  tier={form}
                  index={index}
                  total={tiers.length}
                  canDelete={!used && !props.readOnly}
                  deleteBlockedReason={used ? "Has orders, so it can't be removed. Turn it off to stop selling it." : undefined}
                  onEdit={() => open(form, index)}
                  onMove={(direction) => void actions.move(index, direction)}
                  onDelete={() => void actions.remove(tier)}
                  onDuplicate={() => void actions.duplicate(tier)}
                  onToggleActive={props.readOnly ? undefined : () => void actions.toggleActive(tier)}
                  accentClass={tierAccent(index).bar}
                  priceNote={allIn(Number(tier.price))}
                  editButtonId={editId(tier.id)}
                />
              </li>
            );
          })}
        </ul>
      )}

      <button
        id={ADD_ID}
        type="button"
        onClick={() => open(newTierForm(), tiers.length)}
        aria-describedby={addError ? `${ADD_ID}-error` : undefined}
        className={secondaryButton}
      >
        <Plus className="h-4 w-4" aria-hidden />
        Add tier
      </button>
      {addError && (
        <p id={`${ADD_ID}-error`} className={errorText}>
          {addError}
        </p>
      )}

      <p role="status" className="sr-only">
        {actions.notice}
      </p>
      {actions.error && (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
          {actions.error}
        </p>
      )}

      {editing && (
        <TierEditDialog
          key={editing.form.key}
          tier={editing.form}
          index={editing.index}
          zone={zone}
          errors={errors}
          busy={busy}
          saveLabel="Save tier"
          onSave={(draft) => void save(draft)}
          onCancel={close}
        />
      )}
    </section>
  );
}
