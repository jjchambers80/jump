'use client';

// "Add a … application" dialog (spec 050 §5.2): name, what the form is for
// (Other applications only), whether it charges, and where it starts: blank
// with Jump's defaults for the purpose (backend applicationFormDefaults.js),
// or one of the org's templates for that purpose. Modal: focus trap, Escape,
// focus back to the opener (useDialog).

import { FormEvent, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useDialog } from '@/lib/useDialog';
import type { FormKind, FormPurpose, FormTemplateSummary } from '@/lib/applications';
import { FREE_ONLY, PURPOSE_LABEL, templatesFor, type ApplicationStepConfig } from '../applicationSteps';
import { hintClass, iconButton, inputClass, labelClass, primaryButton, secondaryButton } from '../ui';

/** Purposes whose blank form starts with Jump's suggested questions. */
const SUGGESTED = new Set<FormPurpose>(['VENDOR', 'SPECIAL_GUEST', 'VOLUNTEER']);

export interface NewFormBody {
  name: string;
  kind: FormKind;
  purpose: FormPurpose;
  templateId?: string;
}

interface Props {
  config: ApplicationStepConfig;
  eventName: string;
  templates: FormTemplateSummary[];
  onCreate: (body: NewFormBody) => Promise<void>;
  onClose: () => void;
}

export default function AddFormDialog({ config, eventName, templates, onCreate, onClose }: Props) {
  const panelRef = useDialog<HTMLDivElement>(true, onClose);
  // After useDialog's own first focus (the Close button): start on the Name field.
  useEffect(() => document.getElementById('add-form-name')?.focus(), []);
  const [name, setName] = useState(`${eventName} ${config.nameSuffix}`.trim());
  const [purpose, setPurpose] = useState<FormPurpose>(config.purposes[0]);
  const [paid, setPaid] = useState(config.defaultKind === 'PAID');
  const [templateId, setTemplateId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const freeOnly = FREE_ONLY[purpose];
  const kind: FormKind = paid && !freeOnly ? 'PAID' : 'FREE';
  const options = templatesFor(templates, purpose, kind);
  const chosen = options.some((t) => t.id === templateId) ? templateId : '';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (name.trim().length < 2) return setError('Enter a name of at least 2 characters');
    setBusy(true);
    setError(null);
    try {
      await onCreate({ name: name.trim(), kind, purpose, ...(chosen && { templateId: chosen }) });
    } catch (err) {
      setError((err as Error)?.message || "Couldn't create the form");
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div aria-hidden className="pointer-events-none fixed inset-0 bg-black/50" />
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="add-form-title" className="relative max-h-[90vh] w-full overflow-y-auto rounded-t-lg bg-white shadow-sm dark:bg-slate-800 sm:max-w-lg sm:rounded-lg">
        <form onSubmit={submit} noValidate>
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2 dark:border-slate-700 sm:px-6">
            <h2 id="add-form-title" className="text-lg font-semibold text-gray-900 dark:text-white">
              {config.addLabel}
            </h2>
            <button type="button" onClick={onClose} aria-label="Close" className={iconButton}>
              <X className="h-5 w-5" aria-hidden />
            </button>
          </div>
          <div className="space-y-4 px-4 py-4 sm:px-6">
            {error && (
              <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
                {error}
              </p>
            )}
            <div>
              <label htmlFor="add-form-name" className={labelClass}>Name</label>
              <input id="add-form-name" value={name} maxLength={255} onChange={(e) => setName(e.target.value)} className={inputClass} />
            </div>
            {config.purposes.length > 1 && (
              <div>
                <label htmlFor="add-form-purpose" className={labelClass}>What is this form for?</label>
                <select id="add-form-purpose" value={purpose} onChange={(e) => setPurpose(e.target.value as FormPurpose)} className={inputClass}>
                  {config.purposes.map((p) => (
                    <option key={p} value={p}>{PURPOSE_LABEL[p]}</option>
                  ))}
                </select>
              </div>
            )}
            {freeOnly ? (
              <p className={hintClass}>{freeOnly}</p>
            ) : (
              <div>
                <label className="flex min-h-11 items-center gap-2 text-sm font-medium text-gray-800 dark:text-slate-200">
                  <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} className="h-5 w-5 accent-accent-600" aria-describedby="add-form-paid-hint" />
                  {purpose === 'VENDOR' ? 'Charge for space' : 'Charge applicants'}
                </label>
                <p id="add-form-paid-hint" className={hintClass}>
                  {paid ? 'Approved applicants pay for a category you set up next.' : 'Applicants apply and are approved without paying.'}
                </p>
              </div>
            )}
            <fieldset>
              <legend className={labelClass}>Start from</legend>
              <ul className="mt-1 space-y-2">
                {[{ id: '', name: 'Blank form' }, ...options].map((t) => (
                  <li key={t.id || 'blank'}>
                    <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-gray-200 px-3 py-2.5 text-sm has-[:checked]:border-accent-500 dark:border-slate-600">
                      <input type="radio" name="add-form-template" checked={chosen === t.id} onChange={() => setTemplateId(t.id)} className="mt-0.5 h-4 w-4 accent-accent-600" />
                      <span className="min-w-0">
                        <span className="block font-medium text-gray-900 dark:text-white">{t.name}</span>
                        <span className="block text-gray-600 dark:text-slate-400">
                          {t.id ? 'Saved template' : SUGGESTED.has(purpose) ? `Suggested questions for a ${PURPOSE_LABEL[purpose].toLowerCase()} form` : 'No questions yet'}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          </div>
          <div className="flex justify-end gap-2 border-t border-gray-200 px-4 py-3 dark:border-slate-700 sm:px-6">
            <button type="button" onClick={onClose} className={secondaryButton}>Cancel</button>
            <button type="submit" disabled={busy} className={primaryButton}>{busy ? 'Creating…' : 'Create form'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
