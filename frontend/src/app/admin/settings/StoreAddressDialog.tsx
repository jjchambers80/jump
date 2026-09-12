'use client';

import { FormEvent, RefObject, useRef, useState } from 'react';
import api from '@/services/api';
import { BusinessDetails, BusinessDetailsPayload, US_STATES } from './types';
import SettingsDialog from './SettingsDialog';
import { errorClass, fieldClass, formAlertClass, hintClass, labelClass, zipError } from './formShared';

interface StoreAddressDialogProps {
  details: BusinessDetails;
  onClose: () => void;
  onSaved: (details: BusinessDetails) => void;
  returnFocusRef: RefObject<HTMLElement>;
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

/** Dialog for the legal company name and US mailing address. */
export default function StoreAddressDialog({ details, onClose, onSaved, returnFocusRef }: StoreAddressDialogProps) {
  const [form, setForm] = useState<FormState>(() => initialForm(details));
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  const dirty = isDirty(form, initialForm(details));

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
    } catch (error: any) {
      setErrors((current) => ({ ...current, form: error.message || 'Unable to save store address.' }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsDialog
      titleId="store-address-dialog-title"
      title="Edit store address"
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
          <label htmlFor="company-name" className={labelClass}>Company name</label>
          <input
            ref={firstFieldRef}
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
    </SettingsDialog>
  );
}
