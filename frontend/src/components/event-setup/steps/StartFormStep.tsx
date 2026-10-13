'use client';

// Start of an application flow (spec 051, simplified): name, what the form
// is for (Other applications only) and whether it charges. Every form starts
// blank — it asks for an email only; the rest is added on the Fields step.
// An event has one live form per purpose: when the chosen purpose already has
// one (Other applications), Start links to it instead of creating another.
// The wizard footer's Next submits this form (`START_FORM_ID`); the flow then
// moves to the new form's details.

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import type { DraftForm } from '../previewMessages';
import type { FormKind, FormPurpose } from '@/lib/applications';
import { FREE_ONLY, PURPOSE_LABEL, type ApplicationStepConfig } from '../applicationSteps';
import { hintClass, inputClass, labelClass } from '../ui';

export const START_FORM_ID = 'flow-start-form';

export interface NewFormBody {
  name: string;
  kind: FormKind;
  purpose: FormPurpose;
}

interface Props {
  config: ApplicationStepConfig;
  /** This event's live (not closed) forms of the type: one per purpose. */
  live: { purpose: FormPurpose; name: string; href: string }[];
  /** Create in flight (the footer's Next waits). */
  onBusyChange: (busy: boolean) => void;
  /** Every change to name, purpose or kind: the live preview shows the form as it is set up. */
  onDraftChange: (draft: DraftForm) => void;
  eventName: string;
  onCreate: (body: NewFormBody) => Promise<void>;
}

export default function StartFormStep({ config, live, onBusyChange, onDraftChange, eventName, onCreate }: Props) {
  const [name, setName] = useState(`${eventName} ${config.nameSuffix}`.trim());
  const [purpose, setPurpose] = useState<FormPurpose>(config.purposes[0]);
  const [paid, setPaid] = useState(config.defaultKind === 'PAID');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const freeOnly = FREE_ONLY[purpose];
  const kind: FormKind = paid && !freeOnly ? 'PAID' : 'FREE';
  useEffect(() => onDraftChange({ name, kind, purpose }), [name, kind, purpose, onDraftChange]);
  const taken = live.find((f) => f.purpose === purpose);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || taken) return;
    if (name.trim().length < 2) return setError('Enter a name of at least 2 characters');
    setBusy(true);
    onBusyChange(true);
    setError(null);
    try {
      await onCreate({ name: name.trim(), kind, purpose });
    } catch (err) {
      setError((err as Error)?.message || "Couldn't create the form");
      setBusy(false);
      onBusyChange(false);
    }
  };

  return (
    <form id={START_FORM_ID} onSubmit={submit} noValidate aria-label={config.addLabel} aria-busy={busy || undefined} className="space-y-4">
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
          <select id="add-form-purpose" value={purpose} onChange={(e) => setPurpose(e.target.value as FormPurpose)} aria-describedby={taken ? 'add-form-taken' : undefined} className={inputClass}>
            {config.purposes.map((p) => (
              <option key={p} value={p}>{PURPOSE_LABEL[p]}</option>
            ))}
          </select>
          {taken && (
            <p id="add-form-taken" className={hintClass}>
              This event already has a {PURPOSE_LABEL[purpose].toLowerCase()} form.{' '}
              <Link href={taken.href} className="font-medium text-accent-700 underline dark:text-accent-300">
                Open {taken.name}
              </Link>
            </p>
          )}
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
            {paid ? 'Approved applicants pay for an option you set up next.' : 'Applicants apply and are approved without paying.'}
          </p>
        </div>
      )}
    </form>
  );
}
