'use client';

import { FormEvent, RefObject, useMemo, useRef, useState } from 'react';
import api from '@/services/api';
import { BUSINESS_TYPES, BusinessDetails, BusinessDetailsPayload } from './types';
import SettingsDialog from './SettingsDialog';
import { errorClass, fieldClass, formAlertClass, hintClass, labelClass } from './formShared';
import PeopleSection from './PeopleSection';

interface BusinessDetailsDialogProps {
  details: BusinessDetails;
  onClose: () => void;
  onSaved: (details: BusinessDetails) => void;
  returnFocusRef: RefObject<HTMLElement>;
}

// Store name, contact, and address have their own dialogs on the Settings
// page; this dialog only edits the remaining legal/business fields.
interface FormState {
  businessType: string;
  nickname: string;
  ein: string;
}

type FormErrors = Partial<Record<keyof FormState | 'form', string>>;

function initialForm(details: BusinessDetails): FormState {
  return {
    businessType: details.businessType || '',
    nickname: details.nickname || '',
    ein: '',
  };
}

function validate(form: FormState): FormErrors {
  const errors: FormErrors = {};
  if (!form.businessType) errors.businessType = 'Type of business is required.';
  const einDigits = form.ein.replace(/\D/g, '');
  if (form.ein && einDigits.length !== 9) errors.ein = 'Enter a 9-digit EIN.';
  return errors;
}

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
  const firstFieldRef = useRef<HTMLSelectElement>(null);

  const dirty = JSON.stringify(form) !== JSON.stringify(original) || einCleared;
  const requiredComplete = Boolean(form.businessType);

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
      businessType: form.businessType,
      nickname: form.nickname.trim() || null,
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
    <SettingsDialog
      titleId="business-details-dialog-title"
      title="Edit business details"
      dirty={dirty}
      saving={saving}
      saveDisabled={!requiredComplete}
      childActive={childActive}
      initialFocusRef={firstFieldRef}
      returnFocusRef={returnFocusRef}
      onClose={onClose}
      onSubmit={handleSubmit}
    >
      <fieldset disabled={saving} className="space-y-5">
        <legend className="mb-4 text-sm font-semibold text-gray-900 dark:text-white">About your business</legend>

        {errors.form && <div role="alert" className={formAlertClass}>{errors.form}</div>}

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
          <label htmlFor="nickname" className={labelClass}>Nickname</label>
          <input id="nickname" value={form.nickname} onChange={(event) => update('nickname', event.target.value)} className={fieldClass} />
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
          {errors.ein ? <p className={errorClass}>{errors.ein}</p> : <p className={hintClass}>Leave blank to keep the saved EIN.</p>}
        </div>
      </fieldset>
      <PeopleSection onChildActiveChange={setChildActive} />
    </SettingsDialog>
  );
}
