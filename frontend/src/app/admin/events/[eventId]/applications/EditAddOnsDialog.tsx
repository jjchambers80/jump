'use client';

// Change the add-on lines on an application before any money moves (spec 012
// §2.5). ORGANIZER+; allowed while SUBMITTED / WAITLISTED, or APPROVED with a
// payment due. The backend recomputes the snapshot at today's prices, records
// an ADD_ONS_CHANGED decision and emails the applicant the new total.

import { FormEvent, RefObject, useEffect, useMemo, useState } from 'react';
import SettingsDialog from '@/app/admin/settings/SettingsDialog';
import { formAlertClass } from '@/app/admin/settings/formShared';
import AddOnPicker from '@/components/AddOnPicker';
import { money, type AdminApplication, type TierAddOnOption } from '@/lib/applications';
import { describeError, useApplicationsApi } from './useApplicationsApi';

interface EditAddOnsDialogProps {
  eventId: string;
  application: AdminApplication;
  returnFocusRef: RefObject<HTMLButtonElement>;
  onClose: () => void;
  onSaved: (next: AdminApplication) => void;
}

export default function EditAddOnsDialog({ eventId, application, returnFocusRef, onClose, onSaved }: EditAddOnsDialogProps) {
  const api = useApplicationsApi(eventId);
  const initial = useMemo(() => Object.fromEntries(application.addOns.map((l) => [l.addOnId, l.quantity])), [application.addOns]);
  const [offered, setOffered] = useState<TierAddOnOption[] | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .form(application.form.id)
      .then((form) => {
        const tier = form.tiers.find((t) => t.id === application.tier?.id);
        setOffered(tier?.addOns ?? []);
      })
      .catch((err) => setError(describeError(err, 'Could not load the add-ons')));
  }, [api, application.form.id, application.tier?.id]);

  // Lines the application has but the tier no longer offers (deactivated): keep them visible so they can be dropped.
  const options = useMemo(() => {
    if (!offered) return [];
    const known = new Set(offered.map((a) => a.id));
    const stale = application.addOns
      .filter((l) => !known.has(l.addOnId))
      .map<TierAddOnOption>((l) => ({
        id: l.addOnId,
        name: `${l.name ?? 'Add-on'} (no longer offered)`,
        description: null,
        price: l.unitPrice,
        taxable: true,
        applicantPays: l.applicantPays / l.quantity,
        maxPerOrder: l.quantity,
        remaining: 0,
        soldOut: true,
        allTiers: false,
        isActive: false,
      }));
    return [...offered.filter((a) => a.isActive || initial[a.id]), ...stale];
  }, [offered, application.addOns, initial]);

  const lines = options.filter((a) => (quantities[a.id] ?? 0) > 0).map((a) => ({ addOnId: a.id, quantity: quantities[a.id] }));
  const dirty = JSON.stringify(lines) !== JSON.stringify(Object.entries(initial).map(([addOnId, quantity]) => ({ addOnId, quantity })));
  const tierLine = application.amounts.applicantPays - application.addOns.reduce((s, l) => s + l.applicantPays, 0);
  const estimate = Math.round((tierLine + options.reduce((s, a) => s + a.applicantPays * (quantities[a.id] ?? 0), 0)) * 100) / 100;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || !dirty) return;
    setSaving(true);
    setError(null);
    try {
      onSaved(await api.updateAddOns(application.id, lines));
    } catch (err) {
      setError(describeError(err, 'Could not update the add-ons'));
      setSaving(false);
    }
  };

  return (
    <SettingsDialog
      titleId="edit-add-ons-title"
      title="Edit add-ons"
      dirty={dirty}
      saving={saving}
      saveDisabled={!dirty || !offered}
      submitLabel="Save and email applicant"
      savingLabel="Saving…"
      returnFocusRef={returnFocusRef}
      onClose={onClose}
      onSubmit={handleSubmit}
    >
      <div className="space-y-4" data-testid="edit-add-ons-dialog">
        {error && (
          <div role="alert" className={formAlertClass}>
            {error}
          </div>
        )}
        <p className="text-sm text-gray-700 dark:text-slate-300">
          <strong>{application.profile.businessName}</strong> · {application.tier?.name}. Prices are today&apos;s; the new total replaces the {money(application.amounts.applicantPays)} quoted at submission.
          {application.paymentStatus === 'PAYMENT_DUE' ? ' Their pay-now link will show the new amount.' : ''}
        </p>
        {!offered && !error && <p className="text-sm text-gray-500 dark:text-slate-400">Loading…</p>}
        {offered && options.length === 0 && <p className="text-sm text-gray-500 dark:text-slate-400">This option has no add-ons.</p>}
        {offered && options.length > 0 && (
          <AddOnPicker addOns={options} quantities={quantities} onChange={(id, q) => setQuantities((prev) => ({ ...prev, [id]: q }))} unitPrice={(a) => options.find((x) => x.id === a.id)?.applicantPays ?? a.price} title="" hint="" />
        )}
        {offered && (
          <p className="text-sm text-gray-800 dark:text-slate-200" data-testid="edit-add-ons-estimate">
            Estimated new total: <strong>{money(estimate)}</strong>
            <span className="text-gray-500 dark:text-slate-400"> (exact allocation is computed on save)</span>
          </p>
        )}
      </div>
    </SettingsDialog>
  );
}
