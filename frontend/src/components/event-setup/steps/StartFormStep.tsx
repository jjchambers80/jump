'use client';

// Start of an application flow (spec 051, from the spec 050 "Add a …
// application" dialog): name, what the form is for (Other applications only),
// whether it charges, and where it starts ("Start with", shown only when the
// org has a template of this kind): a blank form (first name, last name and
// email; the rest is added on the Fields step), or one of the org's templates for that purpose ("Also show templates from other kinds
// of forms" widens the list to every template of the same kind, and appears
// only when there are some). Templates are edited on their editor page and
// deleted here: there is no template library page (spec 037 D2). The wizard
// footer's Next submits this form (`START_FORM_ID`); the flow then moves to
// the new form's details. This event's existing forms of the type are listed
// above, to continue one instead.

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import type { DraftForm } from '../previewMessages';
import { ChevronRight, Pencil, Trash2 } from 'lucide-react';
import type { FormKind, FormPurpose, FormTemplateSummary } from '@/lib/applications';
import { FREE_ONLY, PURPOSE_LABEL, templatesFor, type ApplicationStepConfig } from '../applicationSteps';
import { hintClass, inputClass, labelClass, textButton } from '../ui';

export const START_FORM_ID = 'flow-start-form';

const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

export interface NewFormBody {
  name: string;
  kind: FormKind;
  purpose: FormPurpose;
  templateId?: string;
}

interface Props {
  config: ApplicationStepConfig;
  /** This event's forms of the type, with their flow links: continue one instead. */
  existing: { id: string; name: string; status: string; href: string }[];
  /** Create in flight (the footer's Next waits). */
  onBusyChange: (busy: boolean) => void;
  /** Every change to name, purpose or kind: the live preview shows the form as it is set up. */
  onDraftChange: (draft: DraftForm) => void;
  eventName: string;
  /** null while the org's templates are still loading. */
  templates: FormTemplateSummary[] | null;
  /** May edit and delete templates (the same permission as configuring forms). */
  canManage: boolean;
  /** Confirms, deletes, and resolves true when the template is gone. */
  onDeleteTemplate: (template: FormTemplateSummary) => Promise<boolean>;
  onCreate: (body: NewFormBody) => Promise<void>;
}

const STATUS: Record<string, string> = { DRAFT: 'Draft', OPEN: 'Open', CLOSED: 'Closed' };

export default function StartFormStep({ config, existing, onBusyChange, onDraftChange, eventName, templates, canManage, onDeleteTemplate, onCreate }: Props) {
  const [name, setName] = useState(`${eventName} ${config.nameSuffix}`.trim());
  const [purpose, setPurpose] = useState<FormPurpose>(config.purposes[0]);
  const [paid, setPaid] = useState(config.defaultKind === 'PAID');
  const [templateId, setTemplateId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allPurposes, setAllPurposes] = useState(false);
  const freeOnly = FREE_ONLY[purpose];
  const kind: FormKind = paid && !freeOnly ? 'PAID' : 'FREE';
  useEffect(() => onDraftChange({ name, kind, purpose }), [name, kind, purpose, onDraftChange]);
  const loading = templates === null;
  // Templates that could start this form (same kind); the purpose-matched ones first, the rest on request.
  const sameKind = (templates ?? []).filter((t) => t.kind === kind);
  const matching = templatesFor(sameKind, purpose, kind);
  const others = sameKind.filter((t) => !matching.includes(t));
  const options = allPurposes ? sameKind : matching;
  // Nothing saved that fits: no choice to make, so the section stays out of the way.
  const showStartWith = !loading && sameKind.length > 0;
  const standard = { title: 'Blank form', detail: 'Asks for contact details only. Add more on the Fields step.' };
  const removeTemplate = async (template: FormTemplateSummary) => {
    setError(null);
    try {
      if ((await onDeleteTemplate(template)) && templateId === template.id) setTemplateId('');
    } catch (err) {
      setError((err as Error)?.message || "Couldn't delete the template");
    }
  };
  const chosen = options.some((t) => t.id === templateId) ? templateId : '';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || loading) return;
    if (name.trim().length < 2) return setError('Enter a name of at least 2 characters');
    setBusy(true);
    onBusyChange(true);
    setError(null);
    try {
      await onCreate({ name: name.trim(), kind, purpose, ...(chosen && { templateId: chosen }) });
    } catch (err) {
      setError((err as Error)?.message || "Couldn't create the form");
      setBusy(false);
      onBusyChange(false);
    }
  };

  return (
    <div className="space-y-6">
      {existing.length > 0 && (
        <section aria-labelledby="start-existing">
          <h2 id="start-existing" className="text-sm font-semibold text-gray-900 dark:text-white">
            Continue a form on this event
          </h2>
          <ul className="mt-2 divide-y divide-gray-200 rounded-lg border border-gray-200 dark:divide-slate-700 dark:border-slate-700">
            {existing.map((f) => (
              <li key={f.id}>
                <Link
                  href={f.href}
                  className="flex min-h-12 items-center gap-3 px-4 py-2 text-sm hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-500 dark:hover:bg-slate-800"
                >
                  <span className="min-w-0 flex-1 truncate font-medium text-gray-900 dark:text-white">{f.name}</span>
                  <span className="shrink-0 text-gray-600 dark:text-slate-400">{STATUS[f.status] ?? f.status}</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-gray-500 dark:text-slate-400" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <form id={START_FORM_ID} onSubmit={submit} noValidate aria-labelledby="start-new" aria-busy={busy || undefined}>
        <h2 id="start-new" className={existing.length ? 'text-sm font-semibold text-gray-900 dark:text-white' : 'sr-only'}>
          {existing.length ? 'Or start a new one' : config.addLabel}
        </h2>
          <div className={`space-y-4 ${existing.length ? 'mt-3' : ''}`}>
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
            {showStartWith ? (
              <fieldset aria-describedby="add-form-start-hint">
                <legend className={labelClass}>Start with</legend>
                <p id="add-form-start-hint" className={hintClass}>
                  A template copies a form you saved before: its intro, categories, prices and questions.
                </p>
                <ul className="mt-2 space-y-2">
                  {[{ id: '', name: standard.title }, ...options].map((t) => (
                    <li key={t.id || 'standard'}>
                      <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-gray-200 px-3 py-2.5 text-sm has-[:checked]:border-accent-500 dark:border-slate-600">
                        <input type="radio" name="add-form-template" checked={chosen === t.id} onChange={() => setTemplateId(t.id)} className="mt-0.5 h-4 w-4 accent-accent-600" />
                        <span className="min-w-0">
                          <span className="block font-medium text-gray-900 dark:text-white">{t.name}</span>
                          <span className="block text-gray-600 dark:text-slate-400">
                            {t.id
                              ? ['Your template', (t as FormTemplateSummary).tierCount > 0 && plural((t as FormTemplateSummary).tierCount, 'category', 'categories'), plural((t as FormTemplateSummary).questionCount, 'question')].filter(Boolean).join(' · ')
                              : standard.detail}
                          </span>
                        </span>
                      </label>
                      {t.id && canManage && (
                        <div className="mt-1 flex flex-wrap gap-1 pl-7">
                          <Link href={`/admin/events/templates/${t.id}`} className={textButton} aria-label={`Edit template ${t.name}`}>
                            <Pencil className="h-4 w-4" aria-hidden />
                            Edit
                          </Link>
                          <button type="button" onClick={() => void removeTemplate(t as FormTemplateSummary)} className={`${textButton} text-red-700 dark:text-red-300`} aria-label={`Delete template ${t.name}`}>
                            <Trash2 className="h-4 w-4" aria-hidden />
                            Delete
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
                {others.length > 0 && (
                  <label className="mt-2 flex min-h-11 items-center gap-2 text-sm text-gray-800 dark:text-slate-200">
                    <input type="checkbox" checked={allPurposes} onChange={(e) => setAllPurposes(e.target.checked)} className="h-5 w-5 accent-accent-600" />
                    Also show templates from other kinds of forms ({others.length})
                  </label>
                )}
              </fieldset>
            ) : (
              !loading && <p className={hintClass}>{standard.detail}</p>
            )}
          </div>
        </form>
    </div>
  );
}
