'use client';

// Corrections on an application's money before it moves (spec 018 phase 3):
// change tier, add a manual adjustment, waive the balance, record an offline
// payment. Tier / adjustments are ORGANIZER+ while nothing has been charged;
// waive and offline payment are ADMIN on an approved application with a
// payment due. The API enforces every rule; these dialogs explain them.

import { FormEvent, RefObject, useEffect, useMemo, useRef, useState } from 'react';
import SettingsDialog from '@/app/admin/settings/SettingsDialog';
import { fieldClass, formAlertClass, hintClass, labelClass } from '@/app/admin/settings/formShared';
import { money, OFFLINE_METHOD_LABEL, type AdminApplication, type AdminTier, type OfflinePaymentMethod } from '@/lib/applications';
import { describeError, useApplicationsApi } from './useApplicationsApi';

interface DialogProps {
  eventId: string;
  application: AdminApplication;
  returnFocusRef: RefObject<HTMLButtonElement>;
  onClose: () => void;
  onSaved: (next: AdminApplication) => void;
}

const selectClass = `${fieldClass}`;

export function ChangeTierDialog({ eventId, application, returnFocusRef, onClose, onSaved }: DialogProps) {
  const api = useApplicationsApi(eventId);
  const [tiers, setTiers] = useState<AdminTier[] | null>(null);
  const [tierId, setTierId] = useState(application.tier?.id ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    api
      .form(application.form.id)
      .then((form) => setTiers(form.tiers))
      .catch((err) => setError(describeError(err, 'Could not load the tiers')));
  }, [api, application.form.id]);

  const target = tiers?.find((t) => t.id === tierId) ?? null;
  const dirty = tierId !== '' && tierId !== application.tier?.id;
  // Add-on lines the new tier does not offer are dropped by the backend; warn up front.
  const dropped = useMemo(() => {
    if (!target) return [];
    const offered = new Set((target.addOns ?? []).map((a) => a.id));
    return application.addOns.filter((l) => !offered.has(l.addOnId));
  }, [target, application.addOns]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || !dirty) return;
    setSaving(true);
    setError(null);
    try {
      onSaved(await api.changeTier(application.id, tierId));
    } catch (err) {
      setError(describeError(err, 'Could not change the tier'));
      setSaving(false);
    }
  };

  return (
    <SettingsDialog
      titleId="change-tier-dialog-title"
      title="Change tier"
      dirty={dirty}
      saving={saving}
      saveDisabled={!dirty || !target?.isActive}
      submitLabel="Change tier"
      savingLabel="Changing…"
      initialFocusRef={selectRef}
      returnFocusRef={returnFocusRef}
      onClose={onClose}
      onSubmit={handleSubmit}
    >
      <div className="space-y-5">
        {error && (
          <div role="alert" className={formAlertClass}>
            {error}
          </div>
        )}
        <p className="text-sm text-gray-700 dark:text-slate-300">
          <strong>{application.profile.businessName}</strong> is on <strong>{application.tier?.name}</strong> at {money(application.amounts.applicantPays)}. The amount is recomputed at today&apos;s prices with any adjustments, and the applicant is emailed the new total.
        </p>
        <div>
          <label htmlFor="change-tier-select" className={labelClass}>
            New tier
          </label>
          <select ref={selectRef} id="change-tier-select" value={tierId} onChange={(e) => setTierId(e.target.value)} className={selectClass} disabled={!tiers}>
            {(tiers ?? []).map((t) => (
              <option key={t.id} value={t.id} disabled={!t.isActive}>
                {t.name} — {money(t.amounts.applicantPays)}
                {t.id === application.tier?.id ? ' (current)' : ''}
                {!t.isActive ? ' (inactive)' : t.remaining <= 0 && application.capacitySlot === 'RESERVED' ? ' (full)' : ''}
              </option>
            ))}
          </select>
          {target && target.id !== application.tier?.id && (
            <p className={hintClass}>
              {target.remaining} of {target.quantityTotal} left.
              {application.capacitySlot === 'RESERVED' ? ' This application holds a slot; it moves to the new tier now.' : ' Nothing is held until approval.'}
            </p>
          )}
        </div>
        {dropped.length > 0 && (
          <p role="note" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200" data-testid="change-tier-dropped">
            {target?.name} does not offer {dropped.map((l) => `${l.name} ×${l.quantity}`).join(', ')}; these lines will be removed.
          </p>
        )}
      </div>
    </SettingsDialog>
  );
}

export function AdjustmentDialog({ eventId, application, returnFocusRef, onClose, onSaved }: DialogProps) {
  const api = useApplicationsApi(eventId);
  const [kind, setKind] = useState<'discount' | 'charge'>('discount');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);

  const value = Number(amount);
  const signed = kind === 'discount' ? -Math.abs(value) : Math.abs(value);
  const tierPrice = application.tier?.price ?? 0;
  const applied = application.adjustments.filter((a) => a.kind === 'ADJUSTMENT').reduce((s, a) => s + a.amount, 0);
  const floor = Math.round((tierPrice + applied) * 100) / 100; // the deepest discount still allowed
  const valid = Number.isFinite(value) && value > 0 && reason.trim().length > 0 && !(kind === 'discount' && value > floor + 1e-9);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || !valid) return;
    setSaving(true);
    setError(null);
    try {
      onSaved(await api.addAdjustment(application.id, { amount: Math.round(signed * 100) / 100, reason: reason.trim() }));
    } catch (err) {
      setError(describeError(err, 'Could not add the adjustment'));
      setSaving(false);
    }
  };

  return (
    <SettingsDialog
      titleId="adjustment-dialog-title"
      title="Adjust amount"
      dirty={amount !== '' || reason.trim() !== ''}
      saving={saving}
      saveDisabled={!valid}
      submitLabel={valid ? `${kind === 'discount' ? 'Discount' : 'Add'} ${money(Math.abs(value))}` : 'Add adjustment'}
      savingLabel="Saving…"
      initialFocusRef={amountRef}
      returnFocusRef={returnFocusRef}
      onClose={onClose}
      onSubmit={handleSubmit}
    >
      <div className="space-y-5">
        {error && (
          <div role="alert" className={formAlertClass}>
            {error}
          </div>
        )}
        <p className="text-sm text-gray-700 dark:text-slate-300">
          A signed line on the amount — a discount, a waived fee, a late charge. Fees and tax are recomputed on the adjusted total; the applicant is not emailed (change the tier or add-ons for that).
        </p>
        <div className="flex gap-2" role="radiogroup" aria-label="Adjustment kind">
          {(['discount', 'charge'] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              onClick={() => setKind(k)}
              className={`rounded-md border px-3 py-1.5 text-sm font-medium ${kind === k ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-gray-300 bg-white text-gray-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200'}`}
            >
              {k === 'discount' ? 'Discount' : 'Extra charge'}
            </button>
          ))}
        </div>
        <div>
          <label htmlFor="adjustment-amount" className={labelClass}>
            Amount
          </label>
          <input ref={amountRef} id="adjustment-amount" type="number" inputMode="decimal" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={fieldClass} />
          <p className={hintClass}>
            {kind === 'discount' ? `Up to ${money(floor)} — the ${application.tier?.name ?? 'tier'} price after adjustments already applied. Deeper than that: remove add-ons or waive the balance.` : 'Added to the tier line before fees and tax.'}
          </p>
        </div>
        <div>
          <label htmlFor="adjustment-reason" className={labelClass}>
            Reason
          </label>
          <input id="adjustment-reason" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} className={fieldClass} placeholder="e.g. Returning vendor discount" />
        </div>
      </div>
    </SettingsDialog>
  );
}

export function WaiveDialog({ eventId, application, returnFocusRef, onClose, onSaved }: DialogProps) {
  const api = useApplicationsApi(eventId);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reasonRef = useRef<HTMLInputElement>(null);
  const valid = reason.trim().length > 0;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || !valid) return;
    setSaving(true);
    setError(null);
    try {
      onSaved(await api.waive(application.id, { reason: reason.trim() }));
    } catch (err) {
      setError(describeError(err, 'Could not waive the balance'));
      setSaving(false);
    }
  };

  return (
    <SettingsDialog
      titleId="waive-dialog-title"
      title="Waive balance"
      dirty={reason.trim() !== ''}
      saving={saving}
      saveDisabled={!valid}
      submitLabel={`Waive ${money(application.amounts.applicantPays)}`}
      savingLabel="Waiving…"
      initialFocusRef={reasonRef}
      returnFocusRef={returnFocusRef}
      onClose={onClose}
      onSubmit={handleSubmit}
    >
      <div className="space-y-5">
        {error && (
          <div role="alert" className={formAlertClass}>
            {error}
          </div>
        )}
        <p className="text-sm text-gray-700 dark:text-slate-300">
          <strong>{application.profile.businessName}</strong> owes {money(application.amounts.applicantPays)}. Waiving sets it to nothing owed, confirms their spot, and emails them. The waived amount stays on record; this cannot be undone.
        </p>
        <div>
          <label htmlFor="waive-reason" className={labelClass}>
            Reason
          </label>
          <input ref={reasonRef} id="waive-reason" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} className={fieldClass} placeholder="e.g. Sponsor trade" />
        </div>
      </div>
    </SettingsDialog>
  );
}

const METHODS: OfflinePaymentMethod[] = ['CHEQUE', 'CASH', 'BANK_TRANSFER', 'COMPED', 'OTHER'];

export function OfflinePaymentDialog({ eventId, application, returnFocusRef, onClose, onSaved }: DialogProps) {
  const api = useApplicationsApi(eventId);
  const [method, setMethod] = useState<OfflinePaymentMethod>('CHEQUE');
  const [reference, setReference] = useState('');
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const methodRef = useRef<HTMLSelectElement>(null);
  const due = application.amounts.applicantPays;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      onSaved(await api.recordOfflinePayment(application.id, { method, amount: due, reference: reference.trim() || null, paidAt: paidAt ? new Date(`${paidAt}T12:00:00`).toISOString() : null }));
    } catch (err) {
      setError(describeError(err, 'Could not record the payment'));
      setSaving(false);
    }
  };

  return (
    <SettingsDialog
      titleId="offline-payment-dialog-title"
      title="Record offline payment"
      dirty={reference.trim() !== '' || method !== 'CHEQUE'}
      saving={saving}
      submitWhenClean
      submitLabel={`Record ${money(due)}`}
      savingLabel="Recording…"
      initialFocusRef={methodRef}
      returnFocusRef={returnFocusRef}
      onClose={onClose}
      onSubmit={handleSubmit}
    >
      <div className="space-y-5">
        {error && (
          <div role="alert" className={formAlertClass}>
            {error}
          </div>
        )}
        <p className="text-sm text-gray-700 dark:text-slate-300">
          Records that <strong>{application.profile.businessName}</strong> paid {money(due)} outside Jump. Their spot is confirmed and they are emailed; nothing is charged in Stripe. The amount must match what is owed — add an adjustment first to change it.
        </p>
        <div>
          <label htmlFor="offline-method" className={labelClass}>
            Method
          </label>
          <select ref={methodRef} id="offline-method" value={method} onChange={(e) => setMethod(e.target.value as OfflinePaymentMethod)} className={selectClass}>
            {METHODS.map((m) => (
              <option key={m} value={m}>
                {OFFLINE_METHOD_LABEL[m]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="offline-reference" className={labelClass}>
            Reference (optional)
          </label>
          <input id="offline-reference" maxLength={120} value={reference} onChange={(e) => setReference(e.target.value)} className={fieldClass} placeholder="e.g. Cheque #1042" />
        </div>
        <div>
          <label htmlFor="offline-paid-at" className={labelClass}>
            Date received
          </label>
          <input id="offline-paid-at" type="date" value={paidAt} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setPaidAt(e.target.value)} className={fieldClass} />
        </div>
      </div>
    </SettingsDialog>
  );
}
