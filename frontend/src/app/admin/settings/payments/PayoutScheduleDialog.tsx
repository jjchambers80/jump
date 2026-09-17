'use client';

// Payout frequency and statement name (spec 010 phase 2, Shopify screen 5).
// Writes the connected account's payout schedule and the label the
// organization sees on its own bank statement.

import { FormEvent, RefObject, useRef, useState } from 'react';
import SettingsDialog from '../SettingsDialog';
import { errorClass, fieldClass, formAlertClass, hintClass, labelClass } from '../formShared';
import { describeError, usePaymentsApi } from './usePaymentsApi';
import { capitalize, normalizeDescriptor, ordinal, payoutDescriptorError, WEEKDAYS, type ConnectAccount, type ConnectState, type UpdatePayoutSettingsBody } from './types';

interface PayoutScheduleDialogProps {
  account: ConnectAccount;
  returnFocusRef: RefObject<HTMLButtonElement>;
  onClose: () => void;
  onSaved: (connect: ConnectState) => void;
}

type Interval = 'daily' | 'weekly' | 'monthly';

export default function PayoutScheduleDialog({ account, returnFocusRef, onClose, onSaved }: PayoutScheduleDialogProps) {
  const api = usePaymentsApi();
  const current = account.payouts;
  const initialInterval: Interval = current.interval === 'weekly' || current.interval === 'monthly' ? current.interval : 'daily';
  const initialWeekday = current.interval === 'weekly' && current.anchor ? current.anchor : 'friday';
  const initialMonthday = current.interval === 'monthly' && current.anchor ? current.anchor : '1';
  const initialName = current.statementDescriptor ?? '';

  const [interval, setInterval] = useState<Interval>(initialInterval);
  const [weekday, setWeekday] = useState(initialWeekday);
  const [monthday, setMonthday] = useState(initialMonthday);
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectRef = useRef<HTMLSelectElement>(null);

  const nameError = payoutDescriptorError(name);
  const scheduleDirty =
    interval !== initialInterval || (interval === 'weekly' && weekday !== initialWeekday) || (interval === 'monthly' && monthday !== initialMonthday);
  const nameDirty = normalizeDescriptor(name) !== initialName;
  const dirty = scheduleDirty || nameDirty;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || !dirty || nameError) return;
    const body: UpdatePayoutSettingsBody = {};
    if (scheduleDirty) {
      body.interval = interval;
      if (interval === 'weekly') body.anchor = weekday;
      if (interval === 'monthly') body.anchor = Number(monthday);
    }
    if (nameDirty) body.statementDescriptor = normalizeDescriptor(name);
    setSaving(true);
    setError(null);
    try {
      const { connect } = await api.updatePayouts(body);
      onSaved(connect);
    } catch (err) {
      setError(describeError(err, 'Could not save the payout settings'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsDialog
      titleId="payout-schedule-title"
      title="Payout frequency and statement name"
      dirty={dirty}
      saving={saving}
      saveDisabled={nameError !== null}
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

        <div>
          <label htmlFor="payout-interval" className={labelClass}>
            Payout every
          </label>
          <select ref={selectRef} id="payout-interval" value={interval} onChange={(e) => setInterval(e.target.value as Interval)} className={fieldClass}>
            <option value="daily">Business day</option>
            <option value="weekly">Week</option>
            <option value="monthly">Month</option>
          </select>
          <p className={hintClass}>
            {current.delayDays != null
              ? `Funds are available ${current.delayDays} business day${current.delayDays === 1 ? '' : 's'} after a transaction.`
              : 'Stripe holds funds for a short period after each transaction.'}
          </p>
        </div>

        {interval === 'weekly' && (
          <div>
            <label htmlFor="payout-weekday" className={labelClass}>
              On
            </label>
            <select id="payout-weekday" value={weekday} onChange={(e) => setWeekday(e.target.value)} className={fieldClass}>
              {WEEKDAYS.map((day) => (
                <option key={day} value={day}>
                  {capitalize(day)}
                </option>
              ))}
            </select>
          </div>
        )}

        {interval === 'monthly' && (
          <div>
            <label htmlFor="payout-monthday" className={labelClass}>
              On day
            </label>
            <select id="payout-monthday" value={monthday} onChange={(e) => setMonthday(e.target.value)} className={fieldClass}>
              {Array.from({ length: 31 }, (_, i) => String(i + 1)).map((day) => (
                <option key={day} value={day}>
                  {ordinal(Number(day))}
                </option>
              ))}
            </select>
            <p className={hintClass}>Months with fewer days pay out on the last day.</p>
          </div>
        )}

        <div>
          <label htmlFor="payout-name" className={labelClass}>
            Payout name
          </label>
          <input
            id="payout-name"
            type="text"
            value={name}
            maxLength={22}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={nameError !== null}
            aria-describedby="payout-name-help"
            className={`${fieldClass} uppercase`}
            autoComplete="off"
            spellCheck={false}
          />
          <p id="payout-name-help" className={hintClass}>
            Shown on your bank statement for every payout. Letters, numbers and spaces; 22 characters or fewer.
          </p>
          {nameError && name !== initialName && (
            <p role="alert" className={errorClass}>
              {nameError}
            </p>
          )}
        </div>
      </div>
    </SettingsDialog>
  );
}
