'use client';

import { FormEvent, RefObject, useRef, useState } from 'react';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import SettingsDialog from '@/app/admin/settings/SettingsDialog';
import { errorClass, fieldClass, formAlertClass, hintClass, labelClass } from '@/app/admin/settings/formShared';
import { Account, accountApi } from './accountApi';

interface Props {
  account: Account;
  onClose: () => void;
  onSaved: (account: Account) => void;
  returnFocusRef: RefObject<HTMLElement>;
}

/** "+19195550100" → "(919) 555-0100"; international numbers keep their own format. */
export function formatAccountPhone(phone: string | null): string {
  if (!phone) return '';
  const parsed = parsePhoneNumberFromString(phone);
  if (!parsed) return phone;
  return parsed.country === 'US' ? parsed.formatNational() : parsed.formatInternational();
}

export default function PhoneDialog({ account, onClose, onSaved, returnFocusRef }: Props) {
  const initial = formatAccountPhone(account.phone);
  const [phone, setPhone] = useState(initial);
  const [errors, setErrors] = useState<{ phone?: string; form?: string }>({});
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const dirty = phone !== initial;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    let value: string | null = null;
    if (phone.trim()) {
      const parsed = parsePhoneNumberFromString(phone.trim(), 'US');
      if (!parsed || !parsed.isValid()) {
        setErrors({ phone: 'Enter a valid phone number.' });
        return;
      }
      value = parsed.number;
    }
    try {
      setSaving(true);
      onSaved(await accountApi.update({ phone: value }));
    } catch (error: any) {
      setErrors({ form: error.message || 'Unable to save your phone number.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsDialog
      titleId="account-phone-dialog-title"
      title={account.phone ? 'Edit phone number' : 'Add phone number'}
      dirty={dirty}
      saving={saving}
      initialFocusRef={inputRef}
      returnFocusRef={returnFocusRef}
      onClose={onClose}
      onSubmit={handleSubmit}
    >
      <fieldset disabled={saving} className="space-y-5">
        {errors.form && <div role="alert" className={formAlertClass}>{errors.form}</div>}
        <div>
          <label htmlFor="account-phone" className={labelClass}>Phone number</label>
          <input
            ref={inputRef}
            id="account-phone"
            value={phone}
            onChange={(e) => { setPhone(e.target.value); setErrors({}); }}
            aria-invalid={Boolean(errors.phone)}
            aria-describedby={errors.phone ? 'account-phone-error' : 'account-phone-hint'}
            className={fieldClass}
            inputMode="tel"
            autoComplete="tel"
            placeholder="(919) 555-0100"
          />
          {errors.phone ? (
            <p id="account-phone-error" className={errorClass}>{errors.phone}</p>
          ) : (
            <p id="account-phone-hint" className={hintClass}>
              Used for account recovery contact only. Clear the field to remove your number. Include the country code for numbers outside the US.
            </p>
          )}
        </div>
      </fieldset>
    </SettingsDialog>
  );
}
