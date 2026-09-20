'use client';

import { FormEvent, RefObject, useRef, useState } from 'react';
import SettingsDialog from '@/app/admin/settings/SettingsDialog';
import { errorClass, fieldClass, formAlertClass, labelClass } from '@/app/admin/settings/formShared';
import { Account, accountApi } from './accountApi';

interface Props {
  account: Account;
  onClose: () => void;
  onSaved: (account: Account) => void;
  returnFocusRef: RefObject<HTMLElement>;
}

const NAME_MAX = 80;

export default function NameDialog({ account, onClose, onSaved, returnFocusRef }: Props) {
  const [firstName, setFirstName] = useState(account.firstName || '');
  const [lastName, setLastName] = useState(account.lastName || '');
  const [errors, setErrors] = useState<{ firstName?: string; lastName?: string; form?: string }>({});
  const [saving, setSaving] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);

  const dirty = firstName !== (account.firstName || '') || lastName !== (account.lastName || '');

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const next: typeof errors = {};
    if (firstName.trim().length > NAME_MAX) next.firstName = `First name must be ${NAME_MAX} characters or fewer.`;
    if (lastName.trim().length > NAME_MAX) next.lastName = `Last name must be ${NAME_MAX} characters or fewer.`;
    if (Object.keys(next).length) {
      setErrors(next);
      return;
    }
    try {
      setSaving(true);
      onSaved(await accountApi.update({ firstName: firstName.trim() || null, lastName: lastName.trim() || null }));
    } catch (error: any) {
      setErrors({ form: error.message || 'Unable to save your name.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsDialog
      titleId="account-name-dialog-title"
      title="Edit name"
      dirty={dirty}
      saving={saving}
      initialFocusRef={firstRef}
      returnFocusRef={returnFocusRef}
      onClose={onClose}
      onSubmit={handleSubmit}
    >
      <fieldset disabled={saving} className="space-y-5">
        {errors.form && <div role="alert" className={formAlertClass}>{errors.form}</div>}
        <div>
          <label htmlFor="account-first-name" className={labelClass}>First name</label>
          <input
            ref={firstRef}
            id="account-first-name"
            value={firstName}
            onChange={(e) => { setFirstName(e.target.value); setErrors({}); }}
            aria-invalid={Boolean(errors.firstName)}
            aria-describedby={errors.firstName ? 'account-first-name-error' : undefined}
            className={fieldClass}
            autoComplete="given-name"
          />
          {errors.firstName && <p id="account-first-name-error" className={errorClass}>{errors.firstName}</p>}
        </div>
        <div>
          <label htmlFor="account-last-name" className={labelClass}>Last name</label>
          <input
            id="account-last-name"
            value={lastName}
            onChange={(e) => { setLastName(e.target.value); setErrors({}); }}
            aria-invalid={Boolean(errors.lastName)}
            aria-describedby={errors.lastName ? 'account-last-name-error' : undefined}
            className={fieldClass}
            autoComplete="family-name"
          />
          {errors.lastName && <p id="account-last-name-error" className={errorClass}>{errors.lastName}</p>}
        </div>
      </fieldset>
    </SettingsDialog>
  );
}
