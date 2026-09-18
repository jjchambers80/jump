'use client';

// Refund a paid application (spec 011 phase 2), partially or in full. ADMIN
// only (the API enforces it). The review status is untouched — withdraw
// separately to release the slot.

import { FormEvent, RefObject, useRef, useState } from 'react';
import SettingsDialog from '@/app/admin/settings/SettingsDialog';
import { fieldClass, formAlertClass, hintClass, labelClass } from '@/app/admin/settings/formShared';
import { money, type AdminApplication } from '@/lib/applications';
import { describeError, useApplicationsApi } from './useApplicationsApi';

interface RefundDialogProps {
  eventId: string;
  application: AdminApplication;
  returnFocusRef: RefObject<HTMLButtonElement>;
  onClose: () => void;
  onRefunded: (next: AdminApplication) => void;
}

export default function RefundDialog({ eventId, application, returnFocusRef, onClose, onRefunded }: RefundDialogProps) {
  const api = useApplicationsApi(eventId);
  const max = application.payment.refundable;
  const [amount, setAmount] = useState(max.toFixed(2));
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);

  const value = Number(amount);
  const valid = Number.isFinite(value) && value > 0 && value <= max + 1e-9;
  const full = valid && Math.abs(value - max) < 0.005;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || !valid) return;
    setSaving(true);
    setError(null);
    try {
      const next = await api.refund(application.id, { amount: full ? null : Math.round(value * 100) / 100, reason: reason.trim() || null });
      onRefunded(next);
    } catch (err) {
      setError(describeError(err, 'Could not refund'));
      setSaving(false);
    }
  };

  return (
    <SettingsDialog
      titleId="refund-dialog-title"
      title={application.payment.manualRefund ? 'Record refund' : 'Refund application'}
      dirty={amount !== max.toFixed(2) || reason.trim() !== ''}
      saving={saving}
      saveDisabled={!valid}
      submitWhenClean
      submitLabel={`${application.payment.manualRefund ? 'Record' : 'Refund'} ${full ? money(max) : valid ? money(value) : ''}`}
      savingLabel={application.payment.manualRefund ? 'Recording…' : 'Refunding…'}
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
          <strong>{application.profile.businessName}</strong> paid {money(application.amounts.applicantPays)}
          {application.payment.refundedTotal > 0 ? `; ${money(application.payment.refundedTotal)} already refunded` : ''}. Up to {money(max)} can be {application.payment.manualRefund ? 'recorded as refunded' : 'returned to their card'}.
        </p>
        <div>
          <label htmlFor="refund-amount" className={labelClass}>
            Amount
          </label>
          <input
            ref={amountRef}
            id="refund-amount"
            type="number"
            inputMode="decimal"
            min="0.01"
            max={max}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={fieldClass}
          />
          <p className={hintClass}>
            {application.payment.manualRefund
              ? 'This application was paid outside Jump, so there is no Stripe charge: the refund is recorded here and you return the money yourself.'
              : application.payment.stripeAccountId
                ? 'The organization’s share is pulled back from the connected account and the platform fee is returned, pro rata.'
                : 'Stripe returns the money to the original card in 5–10 business days.'}
          </p>
        </div>
        <div>
          <label htmlFor="refund-reason" className={labelClass}>
            Reason (optional)
          </label>
          <input id="refund-reason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} className={fieldClass} placeholder="e.g. Downgraded to a smaller booth" />
        </div>
        <p className="text-xs text-gray-500 dark:text-slate-400">Refunding does not change the review status. Withdraw the application to release its slot.</p>
      </div>
    </SettingsDialog>
  );
}
