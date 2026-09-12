'use client';

import { FormEvent, useEffect, useState } from 'react';
import api from '@/services/api';
import { BusinessDetails, BusinessDetailsPayload } from './types';
import {
  cardClass,
  emailError,
  errorClass,
  fieldClass,
  hintClass,
  labelClass,
  phoneDigits,
  phoneError,
  primaryButtonClass,
  secondaryButtonClass,
} from './formShared';

interface StoreContactCardProps {
  details: BusinessDetails;
  onSaved: (details: BusinessDetails) => void;
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

/** Inline card for the store's display name, email, and phone number. */
export default function StoreContactCard({ details, onSaved }: StoreContactCardProps) {
  const [form, setForm] = useState<FormState>(() => initialForm(details));
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');

  // Re-sync when another card or the dialog saves fresh details.
  useEffect(() => {
    setForm(initialForm(details));
  }, [details]);

  const original = initialForm(details);
  const dirty =
    form.name !== original.name ||
    form.email !== original.email ||
    form.phoneNumber !== original.phoneNumber;

  const update = (field: keyof FormState, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined, form: undefined }));
    setStatus('');
  };

  const handleCancel = () => {
    setForm(initialForm(details));
    setErrors({});
    setStatus('');
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
      setStatus('Store name saved.');
    } catch (error: any) {
      setErrors((current) => ({ ...current, form: error.message || 'Unable to save store name.' }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form noValidate onSubmit={handleSubmit} aria-labelledby="store-name-heading" className={cardClass}>
      <div className="border-b border-gray-200 px-5 py-4 dark:border-slate-700">
        <h3 id="store-name-heading" className="text-base font-semibold text-gray-900 dark:text-white">Store name</h3>
        <p className={hintClass}>Shown in the organization switcher, on your public pages, and in customer emails.</p>
      </div>

      <fieldset disabled={saving} className="space-y-5 px-5 py-5">
        {errors.form && (
          <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
            {errors.form}
          </div>
        )}

        <div>
          <label htmlFor="store-name" className={labelClass}>Store name</label>
          <input
            id="store-name"
            value={form.name}
            onChange={(event) => update('name', event.target.value)}
            aria-invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? 'store-name-error' : undefined}
            className={fieldClass}
            autoComplete="organization"
          />
          {errors.name && <p id="store-name-error" className={errorClass}>{errors.name}</p>}
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
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
        </div>
      </fieldset>

      <div className="flex items-center justify-end gap-2 border-t border-gray-200 bg-gray-50 px-5 py-3 dark:border-slate-700 dark:bg-slate-800/60">
        <p role="status" aria-live="polite" className="mr-auto text-sm text-green-700 dark:text-green-400">{status}</p>
        <button type="button" onClick={handleCancel} disabled={saving || !dirty} className={secondaryButtonClass}>
          Cancel
        </button>
        <button type="submit" disabled={saving || !dirty} className={primaryButtonClass}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}
