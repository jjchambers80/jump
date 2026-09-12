'use client';

import { FormEvent, RefObject, useRef, useState } from 'react';
import api from '@/services/api';
import { BusinessDetails, BusinessDetailsPayload } from './types';
import SettingsDialog from './SettingsDialog';
import {
  emailError,
  errorClass,
  fieldClass,
  formAlertClass,
  labelClass,
  phoneDigits,
  phoneError,
} from './formShared';

interface StoreContactDialogProps {
  details: BusinessDetails;
  onClose: () => void;
  onSaved: (details: BusinessDetails) => void;
  returnFocusRef: RefObject<HTMLElement>;
}

interface FormState {
  name: string;
  email: string;
  phoneNumber: string;
}

type FormErrors = Partial<Record<keyof FormState | 'form', string>>;

function initialForm(details: BusinessDetails): FormState {
  return {
    name: details.name,
    email: details.email || '',
    phoneNumber: details.phoneNumber || '',
  };
}

function validate(form: FormState): FormErrors {
  const errors: FormErrors = {};
  if (!form.name.trim()) errors.name = 'Store name is required.';
  const email = emailError(form.email);
  if (email) errors.email = email;
  const phone = phoneError(form.phoneNumber);
  if (phone) errors.phoneNumber = phone;
  return errors;
}

/** Dialog for the store's display name, email, and phone number. */
export default function StoreContactDialog({ details, onClose, onSaved, returnFocusRef }: StoreContactDialogProps) {
  const [form, setForm] = useState<FormState>(() => initialForm(details));
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  const original = initialForm(details);
  const dirty =
    form.name !== original.name ||
    form.email !== original.email ||
    form.phoneNumber !== original.phoneNumber;

  const update = (field: keyof FormState, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined, form: undefined }));
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const nextErrors = validate(form);
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    const payload: BusinessDetailsPayload = {
      name: form.name.trim(),
      email: form.email.trim().toLowerCase() || null,
      phoneCountryCode: '+1',
      phoneNumber: form.phoneNumber ? phoneDigits(form.phoneNumber) : null,
    };

    try {
      setSaving(true);
      const saved = await api.patch<BusinessDetails>('/admin/settings/business-details', payload);
      onSaved(saved);
    } catch (error: any) {
      setErrors((current) => ({ ...current, form: error.message || 'Unable to save store contact details.' }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsDialog
      titleId="store-contact-dialog-title"
      title="Edit store contact details"
      dirty={dirty}
      saving={saving}
      initialFocusRef={firstFieldRef}
      returnFocusRef={returnFocusRef}
      onClose={onClose}
      onSubmit={handleSubmit}
    >
      <fieldset disabled={saving} className="space-y-5">
        {errors.form && <div role="alert" className={formAlertClass}>{errors.form}</div>}

        <div>
          <label htmlFor="store-name" className={labelClass}>Store name</label>
          <input
            ref={firstFieldRef}
            id="store-name"
            value={form.name}
            onChange={(event) => update('name', event.target.value)}
            aria-invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? 'store-name-error' : 'store-name-hint'}
            className={fieldClass}
            autoComplete="organization"
          />
          {errors.name ? (
            <p id="store-name-error" className={errorClass}>{errors.name}</p>
          ) : (
            <p id="store-name-hint" className="mt-1 text-xs text-gray-500 dark:text-slate-400">
              Shown in the organization switcher, on your public pages, and in customer emails.
            </p>
          )}
        </div>

        <div>
          <label htmlFor="store-email" className={labelClass}>Store email</label>
          <input
            id="store-email"
            type="email"
            value={form.email}
            onChange={(event) => update('email', event.target.value)}
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? 'store-email-error' : undefined}
            className={fieldClass}
            autoComplete="email"
            inputMode="email"
          />
          {errors.email && <p id="store-email-error" className={errorClass}>{errors.email}</p>}
        </div>

        <div>
          <label htmlFor="store-phone" className={labelClass}>Store phone number</label>
          <div className="mt-1 flex gap-2">
            <div aria-label="Phone country code" className="flex items-center rounded-md border border-gray-300 bg-gray-50 px-3 text-sm dark:border-slate-600 dark:bg-slate-800">🇺🇸 +1</div>
            <input
              id="store-phone"
              value={form.phoneNumber}
              onChange={(event) => update('phoneNumber', event.target.value)}
              aria-invalid={Boolean(errors.phoneNumber)}
              aria-describedby={errors.phoneNumber ? 'store-phone-error' : undefined}
              className={`${fieldClass} mt-0 flex-1`}
              inputMode="tel"
              autoComplete="tel-national"
            />
          </div>
          {errors.phoneNumber && <p id="store-phone-error" className={errorClass}>{errors.phoneNumber}</p>}
        </div>
      </fieldset>
    </SettingsDialog>
  );
}
