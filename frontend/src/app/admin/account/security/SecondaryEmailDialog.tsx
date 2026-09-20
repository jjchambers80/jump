'use client';

import { FormEvent, RefObject, useRef, useState } from 'react';
import SettingsDialog from '@/app/admin/settings/SettingsDialog';
import { emailError, errorClass, fieldClass, formAlertClass, hintClass, labelClass } from '@/app/admin/settings/formShared';
import { accountApi } from '../accountApi';
import { isReauthCancelled, useReauth } from '../useReauth';

interface Props {
  primaryEmail: string;
  onClose: () => void;
  onSaved: (email: string) => void;
  returnFocusRef: RefObject<HTMLElement>;
}

export default function SecondaryEmailDialog({ primaryEmail, onClose, onSaved, returnFocusRef }: Props) {
  const { withReauth } = useReauth();
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<{ email?: string; form?: string }>({});
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = email.trim().toLowerCase();
    const invalid = !trimmed ? 'Enter an email address.' : emailError(trimmed);
    if (invalid) return setErrors({ email: invalid });
    if (trimmed === primaryEmail) return setErrors({ email: 'That is already your primary email.' });
    try {
      setSaving(true);
      const result = await withReauth(() => accountApi.secondaryEmail.set(trimmed));
      onSaved(result.email);
    } catch (error: any) {
      if (isReauthCancelled(error)) return;
      if (error.code === 'EMAIL_TAKEN') setErrors({ email: 'That email address is already in use.' });
      else setErrors({ form: error.message || 'Unable to add the email.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsDialog
      titleId="secondary-email-dialog-title"
      title="Add secondary email"
      dirty={email.trim().length > 0}
      saving={saving}
      submitLabel="Send verification"
      savingLabel="Sending…"
      initialFocusRef={inputRef}
      returnFocusRef={returnFocusRef}
      onClose={onClose}
      onSubmit={submit}
    >
      <fieldset disabled={saving} className="space-y-5">
        {errors.form && <div role="alert" className={formAlertClass}>{errors.form}</div>}
        <div>
          <label htmlFor="secondary-email" className={labelClass}>Secondary email</label>
          <input
            ref={inputRef}
            id="secondary-email"
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setErrors({}); }}
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? 'secondary-email-error' : 'secondary-email-hint'}
            className={fieldClass}
          />
          {errors.email ? (
            <p id="secondary-email-error" className={errorClass}>{errors.email}</p>
          ) : (
            <p id="secondary-email-hint" className={hintClass}>We&apos;ll send a verification link. It can restore access to your account only once verified.</p>
          )}
        </div>
      </fieldset>
    </SettingsDialog>
  );
}
