'use client';

// Refund a transaction from the list (spec 018 phase 1). Orders are refunded
// in full here (per-ticket and per-line refunds live on the order page where
// the lines are visible); applications take a partial amount. ADMIN only —
// the API enforces it.

import { FormEvent, RefObject, useRef, useState } from 'react';
import Link from 'next/link';
import SettingsDialog from '@/app/admin/settings/SettingsDialog';
import { fieldClass, formAlertClass, hintClass, labelClass } from '@/app/admin/settings/formShared';
import { formatMoney, shortReference, type Transaction, type TransactionRefund } from '@/lib/transactions';
import { describeError, useTransactionsApi } from './useTransactionsApi';

interface RefundTransactionDialogProps {
  transaction: Transaction;
  returnFocusRef: RefObject<HTMLButtonElement>;
  onClose: () => void;
  onRefunded: (next: Transaction, refunds: TransactionRefund[]) => void;
}

export default function RefundTransactionDialog({ transaction, returnFocusRef, onClose, onRefunded }: RefundTransactionDialogProps) {
  const api = useTransactionsApi();
  const isOrder = transaction.type === 'ORDER';
  const max = transaction.net;
  const [amount, setAmount] = useState(max.toFixed(2));
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  const value = isOrder ? max : Number(amount);
  const valid = Number.isFinite(value) && value > 0 && value <= max + 1e-9;
  const full = valid && Math.abs(value - max) < 0.005;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || !valid) return;
    setSaving(true);
    setError(null);
    try {
      const body = isOrder ? { reason: reason.trim() || null } : { amount: full ? null : Math.round(value * 100) / 100, reason: reason.trim() || null };
      const result = await api.refund(transaction.type, transaction.id, body);
      onRefunded(result.transaction, result.refunds);
    } catch (err) {
      setError(describeError(err, 'Could not refund'));
      setSaving(false);
    }
  };

  return (
    <SettingsDialog
      titleId="refund-transaction-dialog-title"
      title={isOrder ? `Refund order ${transaction.reference}` : `Refund ${shortReference(transaction)}`}
      dirty={amount !== max.toFixed(2) || reason.trim() !== ''}
      saving={saving}
      saveDisabled={!valid}
      submitWhenClean
      submitLabel={full ? `Refund ${formatMoney(max)}` : `Refund ${valid ? formatMoney(value) : ''}`}
      savingLabel="Refunding…"
      initialFocusRef={firstFieldRef}
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
          <strong>{transaction.businessName || transaction.contact.name}</strong> paid {formatMoney(transaction.gross)} for {transaction.description || transaction.event.name}
          {transaction.refunded > 0 ? `; ${formatMoney(transaction.refunded)} already refunded` : ''}. Up to {formatMoney(max)} can be returned to their card.
        </p>
        {isOrder ? (
          <p className="text-sm text-gray-600 dark:text-slate-400">
            This refunds every remaining ticket and add-on on the order. To refund one ticket or line, use the{' '}
            <Link href={transaction.detailUrl} className="text-indigo-600 hover:underline dark:text-indigo-400">
              order page
            </Link>
            .
          </p>
        ) : (
          <div>
            <label htmlFor="refund-transaction-amount" className={labelClass}>
              Amount
            </label>
            <input
              ref={firstFieldRef}
              id="refund-transaction-amount"
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
              {transaction.stripeAccountId
                ? 'The organization’s share is pulled back from the connected account and the platform fee is returned, pro rata.'
                : 'Stripe returns the money to the original card in 5–10 business days.'}
            </p>
          </div>
        )}
        <div>
          <label htmlFor="refund-transaction-reason" className={labelClass}>
            Reason (optional)
          </label>
          <input
            ref={isOrder ? firstFieldRef : undefined}
            id="refund-transaction-reason"
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={fieldClass}
            placeholder={isOrder ? 'e.g. Event cancelled' : 'e.g. Downgraded to a smaller booth'}
          />
        </div>
        {!isOrder && <p className="text-xs text-gray-500 dark:text-slate-400">Refunding does not change the review status. Withdraw the application to release its slot.</p>}
      </div>
    </SettingsDialog>
  );
}
