'use client';

// Review and open, the last step of an application flow (spec 051): what the
// form is, each part with a link back to its step, then its status (saved by
// the footer's "Save and finish"). Save as template, View public form, and
// Delete (no applications yet) or Close (it has some) live here, from the
// spec 050 form row.

import { useRef, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Inbox, Pencil, Trash2, XCircle } from 'lucide-react';
import type { AdminForm, FormTemplateSummary } from '@/lib/applications';
import type { useApplicationsApi } from '@/app/admin/events/[eventId]/applications/useApplicationsApi';
import { SettingsCard } from '@/components/applications/FormEditorCards';
import { SaveAsTemplateDialog } from '@/components/applications/TemplateDialogs';
import { formatEventDateTime } from '@/lib/eventTime';
import { PURPOSE_LABEL } from '../applicationSteps';
import type { FlowStep, FlowStepKey } from '../formFlows';
import { secondaryButton, textButton } from '../ui';

export const REVIEW_FORM_ID = 'flow-review-form';

interface Props {
  form: AdminForm;
  steps: FlowStep[];
  stepHref: (key: FlowStepKey) => string;
  canEdit: boolean;
  /** The event is a DRAFT: nothing is public until it publishes. */
  eventDraft: boolean;
  api: ReturnType<typeof useApplicationsApi>;
  templates: FormTemplateSummary[];
  onTemplatesChanged: () => void;
  onSaveStatus: (body: Record<string, unknown>) => Promise<void>;
  /** Delete or Close; resolves when the server answered. */
  onRemove: (action: 'delete' | 'close') => Promise<void>;
}

const count = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

export default function ReviewFormStep({ form, steps, stepHref, canEdit, eventDraft, api, templates, onTemplatesChanged, onSaveStatus, onRemove }: Props) {
  const [savingAs, setSavingAs] = useState(false);
  const [notice, setNotice] = useState('');
  const saveAsRef = useRef<HTMLButtonElement>(null);
  const zone = form.timezone ?? null;
  const dates = [form.opensAt && `Opens ${formatEventDateTime(form.opensAt, zone)}`, form.closesAt && `closes ${formatEventDateTime(form.closesAt, zone)}`]
    .filter(Boolean)
    .join(', ');
  const has = (key: FlowStepKey) => steps.some((s) => s.key === key);
  const submitted = form.applicationCount > 0;
  const createdFrom = form.createdFromTemplateId ? templates.find((t) => t.id === form.createdFromTemplateId) : null;

  const rows: { label: string; value: string; step: FlowStepKey }[] = [
    { label: 'Name', value: form.name, step: 'details' },
    { label: 'For', value: `${PURPOSE_LABEL[form.purpose ?? 'OTHER']} · ${form.kind === 'PAID' ? 'Paid' : 'Free'}`, step: 'details' },
    { label: 'Takes applications', value: dates || 'No open or close date', step: 'details' },
    ...(has('options') ? [{ label: 'Options', value: form.tiers.length ? `${count(form.tiers.length, 'option')} · ${form.tiers.map((t) => t.name).join(', ')}` : 'None yet', step: 'options' as const }] : []),
    ...(has('payment') ? [{ label: 'Spaces', value: form.spaceSelection === 'MAP' ? 'Chosen on the floor map' : 'Chosen by option', step: 'payment' as const }] : []),
    ...(has('shifts') ? [{ label: 'Shifts', value: form.shifts?.length ? count(form.shifts.length, 'shift') : 'No shifts', step: 'shifts' as const }] : []),
    { label: 'Questions', value: count(form.questions.length, 'question'), step: 'questions' },
  ];

  return (
    <div className="space-y-6">
      <section aria-labelledby="review-form-summary" className="rounded-lg border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-800">
        <h2 id="review-form-summary" className="sr-only">Summary</h2>
        <dl className="divide-y divide-gray-200 dark:divide-slate-700">
          {rows.map((row) => (
            <div key={row.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-2 text-sm sm:px-5">
              <dt className="pt-1 text-gray-600 dark:text-slate-400">{row.label}</dt>
              <dd className="col-start-1 break-words pb-1 font-medium text-gray-900 dark:text-white">{row.value}</dd>
              <dd className="col-start-2 row-span-2 row-start-1">
                <Link href={stepHref(row.step)} className={textButton} aria-label={`Edit ${row.label.toLowerCase()}`}>
                  <Pencil className="h-4 w-4" aria-hidden />
                  Edit
                </Link>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <div>
        <SettingsCard form={form} canEdit={canEdit} section="status" formId={REVIEW_FORM_ID} hideSubmit onSave={onSaveStatus} />
        <p className="mt-2 text-sm text-gray-600 dark:text-slate-400">
          {eventDraft
            ? 'This event is a draft. An open form takes applications once the event is published.'
            : 'Open takes applications now, inside the dates you set.'}
        </p>
      </div>

      {createdFrom && (
        <p className="text-sm text-gray-600 dark:text-slate-400">
          Created from the{' '}
          <Link href={`/admin/events/templates/${createdFrom.id}`} className="font-medium text-gray-900 underline underline-offset-2 dark:text-white">
            {createdFrom.name}
          </Link>{' '}
          template.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {canEdit && (
          <button ref={saveAsRef} type="button" onClick={() => setSavingAs(true)} className={secondaryButton}>
            Save as template
          </button>
        )}
        {form.status !== 'DRAFT' && (
          <a href={`/events/${form.eventId}/apply/${form.slug}`} target="_blank" rel="noreferrer" className={secondaryButton}>
            View public form
            <ExternalLink className="h-4 w-4" aria-hidden />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        )}
        {submitted && (
          <Link href={`/admin/events/${form.eventId}/applications?form=${encodeURIComponent(form.id)}`} className={secondaryButton}>
            <Inbox className="h-4 w-4" aria-hidden />
            View applications
          </Link>
        )}
        {canEdit &&
          (submitted ? (
            form.status !== 'CLOSED' && (
              <button type="button" onClick={() => void onRemove('close')} className={textButton} aria-describedby="review-form-remove-reason">
                <XCircle className="h-4 w-4" aria-hidden />
                Close form
              </button>
            )
          ) : (
            <button
              type="button"
              onClick={() => window.confirm(`Delete "${form.name}"? This can't be undone.`) && void onRemove('delete')}
              className={`${textButton} text-red-700 dark:text-red-300`}
            >
              <Trash2 className="h-4 w-4" aria-hidden />
              Delete form
            </button>
          ))}
      </div>
      {submitted && canEdit && (
        <p id="review-form-remove-reason" className="text-sm text-gray-600 dark:text-slate-400">
          {count(form.applicationCount, 'application')}, so this form can&apos;t be deleted.
          {form.status === 'CLOSED' ? ' It is closed to new ones.' : ' Close it to stop new ones.'}
        </p>
      )}
      <p role="status" className="sr-only">{notice}</p>

      {savingAs && (
        <SaveAsTemplateDialog
          form={form}
          templates={templates}
          onSave={(body) => api.saveAsTemplate(form.id, body)}
          onSaved={(t, replaced) => {
            setSavingAs(false);
            onTemplatesChanged();
            setNotice(replaced ? `Template "${t.name}" replaced.` : `Saved as the "${t.name}" template.`);
          }}
          returnFocusRef={saveAsRef}
          onClose={() => setSavingAs(false)}
        />
      )}
    </div>
  );
}
