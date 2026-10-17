'use client';

// Start of the registration flow (spec 057): the form's name, which says
// who registers (forms have no type), and whether it charges. Every form
// starts blank: it asks for an email only, the rest is added on the Fields
// step. The wizard footer's Next submits this form (`START_FORM_ID`); the flow
// then moves to the new form's details.

import { FormEvent, useEffect, useState } from 'react';
import type { DraftForm } from '../previewMessages';
import type { FormKind } from '@/lib/applications';
import { hintClass, inputClass, labelClass } from '../ui';

export const START_FORM_ID = 'flow-start-form';

export interface NewFormBody {
  name: string;
  kind: FormKind;
}

interface Props {
  /** Create in flight (the footer's Next waits). */
  onBusyChange: (busy: boolean) => void;
  /** Every change to name or kind: the live preview shows the form as it is set up. */
  onDraftChange: (draft: DraftForm) => void;
  eventName: string;
  onCreate: (body: NewFormBody) => Promise<void>;
}

export default function StartFormStep({ onBusyChange, onDraftChange, eventName, onCreate }: Props) {
  const [name, setName] = useState(eventName);
  const [paid, setPaid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const kind: FormKind = paid ? 'PAID' : 'FREE';
  useEffect(() => onDraftChange({ name, kind }), [name, kind, onDraftChange]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (name.trim().length < 2) return setError('Enter a name of at least 2 characters');
    setBusy(true);
    onBusyChange(true);
    setError(null);
    try {
      await onCreate({ name: name.trim(), kind });
    } catch (err) {
      setError((err as Error)?.message || "Couldn't create the form");
      setBusy(false);
      onBusyChange(false);
    }
  };

  return (
    <form id={START_FORM_ID} onSubmit={submit} noValidate aria-label="Set up the registration form" aria-busy={busy || undefined} className="space-y-4">
      {error && (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </p>
      )}
      <div>
        <label htmlFor="add-form-name" className={labelClass}>Name</label>
        <input id="add-form-name" value={name} maxLength={255} onChange={(e) => setName(e.target.value)} className={inputClass} />
      </div>
      <div>
        <label className="flex min-h-11 items-center gap-2 text-sm font-medium text-gray-800 dark:text-slate-200">
          <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} className="h-5 w-5 accent-accent-600" aria-describedby="add-form-paid-hint" />
          Charge applicants
        </label>
        <p id="add-form-paid-hint" className={hintClass}>
          {paid ? 'Approved applicants pay for an option you set up next.' : 'Applicants apply and are approved without paying.'}
        </p>
      </div>
    </form>
  );
}
