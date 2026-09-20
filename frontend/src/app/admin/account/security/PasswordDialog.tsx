'use client';

import { FormEvent, RefObject, useRef, useState } from 'react';
import SettingsDialog from '@/app/admin/settings/SettingsDialog';
import { errorClass, fieldClass, formAlertClass, hintClass, labelClass } from '@/app/admin/settings/formShared';
import { accountApi } from '../accountApi';
import { isReauthCancelled, useReauth } from '../useReauth';

interface Props {
  hasPassword: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
  returnFocusRef: RefObject<HTMLElement>;
}

const MIN = 12;

export default function PasswordDialog({ hasPassword, onClose, onSaved, returnFocusRef }: Props) {
  const { withReauth } = useReauth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ password?: string; confirm?: string; form?: string }>({});
  const [saving, setSaving] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next: typeof errors = {};
    if (password.length < MIN) next.password = `Use at least ${MIN} characters.`;
    if (confirm !== password) next.confirm = 'Passwords don’t match.';
    if (Object.keys(next).length) {
      setErrors(next);
      return;
    }
    try {
      setSaving(true);
      const result = await withReauth(() => accountApi.password.set(password));
      onSaved(
        `${hasPassword ? 'Password changed' : 'Password added'}${result.otherDevicesSignedOut ? `; ${result.otherDevicesSignedOut} other device${result.otherDevicesSignedOut === 1 ? '' : 's'} signed out` : ''}.`
      );
    } catch (error: any) {
      if (isReauthCancelled(error)) return;
      setErrors({ form: error.message || 'Unable to save the password.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsDialog
      titleId="password-dialog-title"
      title={hasPassword ? 'Change password' : 'Add password'}
      dirty={password.length > 0 || confirm.length > 0}
      saving={saving}
      initialFocusRef={firstRef}
      returnFocusRef={returnFocusRef}
      onClose={onClose}
      onSubmit={submit}
    >
      <fieldset disabled={saving} className="space-y-5">
        {errors.form && <div role="alert" className={formAlertClass}>{errors.form}</div>}
        <div>
          <label htmlFor="new-password" className={labelClass}>New password</label>
          <input
            ref={firstRef}
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setErrors({}); }}
            aria-invalid={Boolean(errors.password)}
            aria-describedby={errors.password ? 'new-password-error' : 'new-password-hint'}
            className={fieldClass}
          />
          {errors.password ? (
            <p id="new-password-error" className={errorClass}>{errors.password}</p>
          ) : (
            <p id="new-password-hint" className={hintClass}>At least {MIN} characters. A phrase works well. Passwords found in known breaches are rejected.</p>
          )}
        </div>
        <div>
          <label htmlFor="confirm-password" className={labelClass}>Confirm password</label>
          <input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => { setConfirm(e.target.value); setErrors({}); }}
            aria-invalid={Boolean(errors.confirm)}
            aria-describedby={errors.confirm ? 'confirm-password-error' : undefined}
            className={fieldClass}
          />
          {errors.confirm && <p id="confirm-password-error" className={errorClass}>{errors.confirm}</p>}
        </div>
        {hasPassword && <p className={hintClass}>Changing your password signs out every other device.</p>}
      </fieldset>
    </SettingsDialog>
  );
}
