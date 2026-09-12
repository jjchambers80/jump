'use client';

import { FormEvent, useEffect, useState } from 'react';
import api from '@/services/api';
import { BusinessDetails, BusinessDetailsPayload, US_STATES } from './types';
import {
  cardClass,
  errorClass,
  fieldClass,
  hintClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
  zipError,
} from './formShared';

interface StoreAddressCardProps {
  details: BusinessDetails;
  onSaved: (details: BusinessDetails) => void;
}

interface FormState {
  companyName: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
}

type FormErrors = Partial<Record<keyof FormState | 'form', string>>;

function initialForm(details: BusinessDetails): FormState {
  return {
    companyName: details.companyName || '',
    addressLine1: details.addressLine1 || '',
    addressLine2: details.addressLine2 || '',
    city: details.city || '',
    state: details.state || '',
    postalCode: details.postalCode || '',
  };
}

function validate(form: FormState): FormErrors {
  const errors: FormErrors = {};
  if (!form.addressLine1.trim()) errors.addressLine1 = 'Address is required.';
  if (!form.city.trim()) errors.city = 'City is required.';
  if (!form.state) errors.state = 'State is required.';
  const zip = zipError(form.postalCode);
  if (zip) errors.postalCode = zip;
  return errors;
}

function isDirty(form: FormState, original: FormState) {
  return (Object.keys(form) as (keyof FormState)[]).some((key) => form[key] !== original[key]);
}

/** Inline card for the legal company name and US mailing address. */
export default function StoreAddressCard({ details, onSaved }: StoreAddressCardProps) {
  const [form, setForm] = useState<FormState>(() => initialForm(details));
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');

  // Re-sync when another card or the dialog saves fresh details.
  useEffect(() => {
    setForm(initialForm(details));
  }, [details]);

  const dirty = isDirty(form, initialForm(details));

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
      companyName: form.companyName.trim() || null,
      countryCode: 'US',
      addressLine1: form.addressLine1.trim(),
      addressLine2: form.addressLine2.trim() || null,
      city: form.city.trim(),
      state: form.state,
      postalCode: form.postalCode.trim(),
    };

    try {
      setSaving(true);
      const saved = await api.patch<BusinessDetails>('/admin/settings/business-details', payload);
      onSaved(saved);
      setStatus('Store address saved.');
    } catch (error: any) {
      setErrors((current) => ({ ...current, form: error.message || 'Unable to save store address.' }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form noValidate onSubmit={handleSubmit} aria-labelledby="store-address-heading" className={cardClass}>
      <div className="border-b border-gray-200 px-5 py-4 dark:border-slate-700">
        <h3 id="store-address-heading" className="text-base font-semibold text-gray-900 dark:text-white">Store address</h3>
        <p className={hintClass}>Used on receipts and for tax purposes.</p>
      </div>

      <fieldset disabled={saving} className="space-y-5 px-5 py-5">
        {errors.form && (
          <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
            {errors.form}
          </div>
        )}

        <div>
          <label htmlFor="company-name" className={labelClass}>Company name</label>
          <input
            id="company-name"
            value={form.companyName}
            onChange={(event) => update('companyName', event.target.value)}
            className={fieldClass}
            autoComplete="organization"
          />
          <p className={hintClass}>Legal entity name, if different from the store name.</p>
        </div>

        <div>
          <label htmlFor="country-region" className={labelClass}>Country/region</label>
          <select id="country-region" value="US" onChange={() => undefined} className={fieldClass} autoComplete="country">
            <option value="US">United States</option>
          </select>
          <p className={hintClass}>Only United States addresses are supported right now.</p>
        </div>

        <div>
          <label htmlFor="store-address-line-1" className={labelClass}>Address</label>
          <input
            id="store-address-line-1"
            value={form.addressLine1}
            onChange={(event) => update('addressLine1', event.target.value)}
            aria-invalid={Boolean(errors.addressLine1)}
            aria-describedby={errors.addressLine1 ? 'store-address-line-1-error' : undefined}
            className={fieldClass}
            autoComplete="address-line1"
          />
          {errors.addressLine1 && <p id="store-address-line-1-error" className={errorClass}>{errors.addressLine1}</p>}
        </div>

        <div>
          <label htmlFor="store-address-line-2" className={labelClass}>Apartment, suite, etc.</label>
          <input
            id="store-address-line-2"
            value={form.addressLine2}
            onChange={(event) => update('addressLine2', event.target.value)}
            className={fieldClass}
            autoComplete="address-line2"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="store-city" className={labelClass}>City</label>
            <input
              id="store-city"
              value={form.city}
              onChange={(event) => update('city', event.target.value)}
              aria-invalid={Boolean(errors.city)}
              aria-describedby={errors.city ? 'store-city-error' : undefined}
              className={fieldClass}
              autoComplete="address-level2"
            />
            {errors.city && <p id="store-city-error" className={errorClass}>{errors.city}</p>}
          </div>
          <div>
            <label htmlFor="store-state" className={labelClass}>State</label>
            <select
              id="store-state"
              value={form.state}
              onChange={(event) => update('state', event.target.value)}
              aria-invalid={Boolean(errors.state)}
              aria-describedby={errors.state ? 'store-state-error' : undefined}
              className={fieldClass}
              autoComplete="address-level1"
            >
              <option value="">Select state</option>
              {US_STATES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
            </select>
            {errors.state && <p id="store-state-error" className={errorClass}>{errors.state}</p>}
          </div>
          <div>
            <label htmlFor="store-postal-code" className={labelClass}>ZIP code</label>
            <input
              id="store-postal-code"
              value={form.postalCode}
              onChange={(event) => update('postalCode', event.target.value)}
              aria-invalid={Boolean(errors.postalCode)}
              aria-describedby={errors.postalCode ? 'store-postal-code-error' : undefined}
              className={fieldClass}
              inputMode="numeric"
              autoComplete="postal-code"
            />
            {errors.postalCode && <p id="store-postal-code-error" className={errorClass}>{errors.postalCode}</p>}
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
