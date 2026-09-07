'use client';

import { FormEvent, RefObject, useEffect, useMemo, useRef, useState } from 'react';
import api from '@/services/api';
import {
  BUSINESS_TYPES,
  BusinessDetails,
  BusinessDetailsPayload,
  US_STATES,
} from './types';
import PeopleSection from './PeopleSection';

interface BusinessDetailsDialogProps {
  details: BusinessDetails;
  onClose: () => void;
  onSaved: (details: BusinessDetails) => void;
  returnFocusRef: RefObject<HTMLButtonElement>;
}

interface FormState {
  name: string;
  businessType: string;
  nickname: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  phoneNumber: string;
  ein: string;
}

type FormErrors = Partial<Record<keyof FormState | 'form', string>>;

function initialForm(details: BusinessDetails): FormState {
  return {
    name: details.name,
    businessType: details.businessType || '',
    nickname: details.nickname || '',
    addressLine1: details.addressLine1 || '',
    addressLine2: details.addressLine2 || '',
    city: details.city || '',
    state: details.state || '',
    postalCode: details.postalCode || '',
    phoneNumber: details.phoneNumber || '',
    ein: '',
  };
}

function validate(form: FormState): FormErrors {
  const errors: FormErrors = {};
  if (!form.name.trim()) errors.name = 'Registered legal business name is required.';
  if (!form.businessType) errors.businessType = 'Type of business is required.';
  if (!form.addressLine1.trim()) errors.addressLine1 = 'Business address is required.';
  if (!form.city.trim()) errors.city = 'City is required.';
  if (!form.state) errors.state = 'State is required.';
  if (!/^\d{5}(-\d{4})?$/.test(form.postalCode.trim())) {
    errors.postalCode = 'Enter a 5-digit ZIP code or ZIP+4.';
  }
  const phoneDigits = form.phoneNumber.replace(/\D/g, '');
  if (form.phoneNumber && phoneDigits.length !== 10) {
    errors.phoneNumber = 'Enter a 10-digit phone number.';
  }
  const einDigits = form.ein.replace(/\D/g, '');
  if (form.ein && einDigits.length !== 9) errors.ein = 'Enter a 9-digit EIN.';
  return errors;
}

const fieldClass =
  'mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';
const labelClass = 'block text-sm font-medium text-gray-700 dark:text-slate-300';
const errorClass = 'mt-1 text-sm text-red-600 dark:text-red-400';

export default function BusinessDetailsDialog({
  details,
  onClose,
  onSaved,
  returnFocusRef,
}: BusinessDetailsDialogProps) {
  const original = useMemo(() => initialForm(details), [details]);
  const [form, setForm] = useState<FormState>(original);
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);
  const [einChanged, setEinChanged] = useState(false);
  const [einCleared, setEinCleared] = useState(false);
  const [childActive, setChildActive] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLSelectElement>(null);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const childActiveRef = useRef(false);

  const dirty = JSON.stringify(form) !== JSON.stringify(original) || einCleared;
  dirtyRef.current = dirty;
  savingRef.current = saving;
  childActiveRef.current = childActive;
  const requiredComplete = Boolean(
    form.name.trim() &&
      form.businessType &&
      form.addressLine1.trim() &&
      form.city.trim() &&
      form.state &&
      form.postalCode.trim()
  );

  const requestClose = () => {
    if (savingRef.current) return;
    if (dirtyRef.current && !window.confirm('Discard unsaved changes?')) return;
    onClose();
  };

  useEffect(() => {
    firstFieldRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (childActiveRef.current) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        if (savingRef.current) return;
        if (dirtyRef.current && !window.confirm('Discard unsaved changes?')) return;
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])'
        )
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      returnFocusRef.current?.focus();
    };
  }, [onClose, returnFocusRef]);

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
      businessType: form.businessType,
      nickname: form.nickname.trim() || null,
      countryCode: 'US',
      addressLine1: form.addressLine1.trim(),
      addressLine2: form.addressLine2.trim() || null,
      city: form.city.trim(),
      state: form.state,
      postalCode: form.postalCode.trim(),
      phoneCountryCode: '+1',
      phoneNumber: form.phoneNumber ? form.phoneNumber.replace(/\D/g, '') : null,
    };
    if (einCleared) payload.ein = null;
    else if (einChanged && form.ein) payload.ein = form.ein.replace(/\D/g, '');

    try {
      setSaving(true);
      const saved = await api.patch<BusinessDetails>('/admin/settings/business-details', payload);
      onSaved(saved);
    } catch (error: any) {
      setErrors((current) => ({ ...current, form: error.message || 'Unable to save business details.' }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-hidden={childActive || undefined}
        aria-labelledby="business-details-dialog-title"
        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-slate-900"
      >
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <header className="flex items-center justify-between gap-4 border-b border-gray-200 px-5 py-4 dark:border-slate-700">
            <h2 id="business-details-dialog-title" className="text-lg font-semibold text-gray-900 dark:text-white">
              Edit business details
            </h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={requestClose}
                disabled={saving}
                className="rounded-md px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Discard
              </button>
              <button
                type="submit"
                disabled={saving || !requiredComplete}
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </header>

          <div className="min-h-0 overflow-y-auto px-5 py-5">
            <fieldset disabled={saving} className="space-y-5">
              <legend className="mb-4 text-sm font-semibold text-gray-900 dark:text-white">About your business</legend>

              {errors.form && (
                <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
                  {errors.form}
                </div>
              )}

              <div>
                <label htmlFor="business-type" className={labelClass}>Type of business</label>
                <div className="mt-1 flex gap-2">
                  <div aria-label="Business country" className="flex items-center rounded-md border border-gray-300 bg-gray-50 px-3 text-sm dark:border-slate-600 dark:bg-slate-800">🇺🇸 US</div>
                  <select
                    ref={firstFieldRef}
                    id="business-type"
                    value={form.businessType}
                    onChange={(event) => update('businessType', event.target.value)}
                    aria-invalid={Boolean(errors.businessType)}
                    className={`${fieldClass} mt-0 flex-1`}
                  >
                    <option value="">Select a business type</option>
                    {BUSINESS_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                  </select>
                </div>
                {errors.businessType && <p className={errorClass}>{errors.businessType}</p>}
              </div>

              <div>
                <label htmlFor="legal-name" className={labelClass}>Registered legal business name</label>
                <input id="legal-name" value={form.name} onChange={(event) => update('name', event.target.value)} aria-invalid={Boolean(errors.name)} className={fieldClass} />
                {errors.name && <p className={errorClass}>{errors.name}</p>}
              </div>

              <div>
                <label htmlFor="nickname" className={labelClass}>Nickname</label>
                <input id="nickname" value={form.nickname} onChange={(event) => update('nickname', event.target.value)} className={fieldClass} />
              </div>

              <div>
                <label htmlFor="business-address" className={labelClass}>Business address</label>
                <input id="business-address" value={form.addressLine1} onChange={(event) => update('addressLine1', event.target.value)} aria-invalid={Boolean(errors.addressLine1)} className={fieldClass} autoComplete="address-line1" />
                {errors.addressLine1 && <p className={errorClass}>{errors.addressLine1}</p>}
              </div>

              <div>
                <label htmlFor="address-line-2" className={labelClass}>Apartment, suite, etc.</label>
                <input id="address-line-2" value={form.addressLine2} onChange={(event) => update('addressLine2', event.target.value)} className={fieldClass} autoComplete="address-line2" />
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label htmlFor="city" className={labelClass}>City</label>
                  <input id="city" value={form.city} onChange={(event) => update('city', event.target.value)} aria-invalid={Boolean(errors.city)} className={fieldClass} autoComplete="address-level2" />
                  {errors.city && <p className={errorClass}>{errors.city}</p>}
                </div>
                <div>
                  <label htmlFor="state" className={labelClass}>State</label>
                  <select id="state" value={form.state} onChange={(event) => update('state', event.target.value)} aria-invalid={Boolean(errors.state)} className={fieldClass} autoComplete="address-level1">
                    <option value="">Select state</option>
                    {US_STATES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
                  </select>
                  {errors.state && <p className={errorClass}>{errors.state}</p>}
                </div>
                <div>
                  <label htmlFor="postal-code" className={labelClass}>ZIP code</label>
                  <input id="postal-code" value={form.postalCode} onChange={(event) => update('postalCode', event.target.value)} aria-invalid={Boolean(errors.postalCode)} className={fieldClass} inputMode="numeric" autoComplete="postal-code" />
                  {errors.postalCode && <p className={errorClass}>{errors.postalCode}</p>}
                </div>
              </div>

              <div>
                <label htmlFor="phone-number" className={labelClass}>Phone number</label>
                <div className="mt-1 flex gap-2">
                  <div aria-label="Phone country code" className="flex items-center rounded-md border border-gray-300 bg-gray-50 px-3 text-sm dark:border-slate-600 dark:bg-slate-800">🇺🇸 +1</div>
                  <input id="phone-number" value={form.phoneNumber} onChange={(event) => update('phoneNumber', event.target.value)} aria-invalid={Boolean(errors.phoneNumber)} className={`${fieldClass} mt-0 flex-1`} inputMode="tel" autoComplete="tel-national" />
                </div>
                {errors.phoneNumber && <p className={errorClass}>{errors.phoneNumber}</p>}
              </div>

              <div>
                <div className="flex items-center justify-between gap-3">
                  <label htmlFor="ein" className={labelClass}>Employer Identification Number (EIN)</label>
                  {details.hasEin && !einCleared && (
                    <button type="button" onClick={() => { setEinCleared(true); setEinChanged(false); update('ein', ''); }} className="text-sm font-medium text-red-600 hover:text-red-500 dark:text-red-400">
                      Clear saved EIN
                    </button>
                  )}
                </div>
                <input
                  id="ein"
                  value={form.ein}
                  placeholder={einCleared ? 'No EIN saved' : details.einMasked || '12-3456789'}
                  onChange={(event) => { setEinChanged(true); setEinCleared(false); update('ein', event.target.value); }}
                  aria-invalid={Boolean(errors.ein)}
                  className={fieldClass}
                  inputMode="numeric"
                  autoComplete="off"
                />
                {errors.ein ? <p className={errorClass}>{errors.ein}</p> : <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">Leave blank to keep the saved EIN.</p>}
              </div>
            </fieldset>
            <PeopleSection onChildActiveChange={setChildActive} />
          </div>
        </form>
      </div>
    </div>
  );
}
