'use client';

import { FormEvent, RefObject, useEffect, useMemo, useRef, useState } from 'react';
import api from '@/services/api';
import { BUSINESS_TYPES, BusinessDetails, BusinessDetailsPayload } from './types';
import { errorClass, fieldClass, labelClass } from './formShared';
import PeopleSection from './PeopleSection';

interface BusinessDetailsDialogProps {
  details: BusinessDetails;
  onClose: () => void;
  onSaved: (details: BusinessDetails) => void;
  returnFocusRef: RefObject<HTMLButtonElement>;
}

// Store name, address, and phone live in the inline cards on the Settings
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
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLSelectElement>(null);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const childActiveRef = useRef(false);

  const dirty = JSON.stringify(form) !== JSON.stringify(original) || einCleared;
  dirtyRef.current = dirty;
  savingRef.current = saving;
  childActiveRef.current = childActive;
  const requiredComplete = Boolean(form.businessType);

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
