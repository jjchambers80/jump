'use client';

import { FormEvent, RefObject, useRef, useState } from 'react';
import SettingsDialog from '@/app/admin/settings/SettingsDialog';
import { fieldClass, formAlertClass, hintClass, labelClass } from '@/app/admin/settings/formShared';
import { Account, accountApi } from './accountApi';

interface Props {
  account: Account;
  onClose: () => void;
  onSaved: (account: Account) => void;
  returnFocusRef: RefObject<HTMLElement>;
}

export default function LanguageDialog({ account, onClose, onSaved, returnFocusRef }: Props) {
  const [locale, setLocale] = useState(account.locale);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const selectRef = useRef<HTMLSelectElement>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      setSaving(true);
      onSaved(await accountApi.update({ locale }));
    } catch (error: any) {
      setFormError(error.message || 'Unable to save your language.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsDialog
      titleId="account-language-dialog-title"
      title="Preferred language"
      dirty={locale !== account.locale}
      saving={saving}
      initialFocusRef={selectRef}
      returnFocusRef={returnFocusRef}
      onClose={onClose}
      onSubmit={handleSubmit}
    >
      <fieldset disabled={saving} className="space-y-5">
        {formError && <div role="alert" className={formAlertClass}>{formError}</div>}
        <div>
          <label htmlFor="account-locale" className={labelClass}>Language</label>
          <select
            ref={selectRef}
            id="account-locale"
            value={locale}
            onChange={(e) => setLocale(e.target.value)}
            aria-describedby="account-locale-hint"
            className={fieldClass}
          >
            {account.supportedLocales.map((option) => (
              <option key={option.code} value={option.code}>{option.label}</option>
            ))}
          </select>
          <p id="account-locale-hint" className={hintClass}>
            When you&apos;re logged in to Jump, this is the language you&apos;ll see. It doesn&apos;t affect the language your customers see on your online store.
          </p>
        </div>
      </fieldset>
    </SettingsDialog>
  );
}
