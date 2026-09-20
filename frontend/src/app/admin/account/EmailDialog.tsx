'use client';

import { FormEvent, RefObject, useRef, useState } from 'react';
import SettingsDialog from '@/app/admin/settings/SettingsDialog';
import { emailError, errorClass, fieldClass, formAlertClass, hintClass, labelClass } from '@/app/admin/settings/formShared';
import { Account, accountApi } from './accountApi';

interface Props {
  account: Account;
  onClose: () => void;
  onSaved: (account: Account) => void;
  returnFocusRef: RefObject<HTMLElement>;
}

/**
 * Starts a verified email change: the new address gets a confirmation link
 * and nothing changes until it is used. The dialog only requests; the
 * pending state (resend / cancel) is shown on the summary row.
 */
export default function EmailDialog({ account, onClose, onSaved, returnFocusRef }: Props) {
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<{ email?: string; form?: string }>({});
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const dirty = email.trim().length > 0;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = email.trim().toLowerCase();
    const invalid = !trimmed ? 'Enter your new email address.' : emailError(trimmed);
    if (invalid) {
      setErrors({ email: invalid });
      return;
    }
    if (trimmed === account.email) {
      setErrors({ email: 'That is already your email address.' });
      return;
    }
    try {
      setSaving(true);
      onSaved(await accountApi.requestEmailChange(trimmed));
    } catch (error: any) {
      if (error.code === 'EMAIL_TAKEN') setErrors({ email: 'That email address is already in use.' });
      else setErrors({ form: error.message || 'Unable to start the email change.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsDialog
      titleId="account-email-dialog-title"
      title="Change email address"
      dirty={dirty}
      saving={saving}
      submitLabel="Send confirmation"
      savingLabel="Sending…"
      initialFocusRef={inputRef}
      returnFocusRef={returnFocusRef}
      onClose={onClose}
      onSubmit={handleSubmit}
    >
      <fieldset disabled={saving} className="space-y-5">
        {errors.form && <div role="alert" className={formAlertClass}>{errors.form}</div>}
        <p className="text-sm text-gray-600 dark:text-slate-400">
          Current email: <span className="font-medium text-gray-900 dark:text-white">{account.email}</span>
        </p>
        <div>
          <label htmlFor="account-new-email" className={labelClass}>New email address</label>
          <input
            ref={inputRef}
            id="account-new-email"
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setErrors({}); }}
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? 'account-new-email-error' : 'account-new-email-hint'}
            className={fieldClass}
            autoComplete="email"
            inputMode="email"
          />
          {errors.email ? (
            <p id="account-new-email-error" className={errorClass}>{errors.email}</p>
          ) : (
            <p id="account-new-email-hint" className={hintClass}>
              We&apos;ll send a confirmation link to the new address. Your email stays the same until you use it.
            </p>
          )}
        </div>
      </fieldset>
    </SettingsDialog>
  );
}
