'use client';

// Steps 8, 10, 11 and 12 (spec 050 §5.2): one container for Vendor
// applications, Special guests, Volunteers and Other applications, each
// listing the event's forms of its purposes. Several forms per step: add (a
// dialog: blank with the purpose's defaults, or a template), edit inline (the
// shared FormEditorCards, one form open at a time, deep link `&form=<id>`),
// delete while a form has no applications, else close. Every save reloads the
// wizard's forms (step visibility, progress) and refreshes the preview.

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Plus } from 'lucide-react';
import { useCan } from '@/components/OrgContext';
import { useParticipantsApi } from '@/components/applications/useParticipantsApi';
import { useApplicationsApi } from '@/app/admin/events/[eventId]/applications/useApplicationsApi';
import type { FormTemplateSummary } from '@/lib/applications';
import { APPLICATION_STEPS, formsOnStep, type ApplicationStepKey } from '../applicationSteps';
import type { SetupForms } from '../useSetupForms';
import LoadingFields from '../LoadingFields';
import AddFormDialog, { type NewFormBody } from './AddFormDialog';
import FormRow from './FormRow';
import InlineFormEditor from './InlineFormEditor';
import { primaryButton, secondaryButton } from '../ui';

interface Props {
  stepKey: ApplicationStepKey;
  eventId: string;
  eventName: string;
  forms: SetupForms;
  refreshPreview: () => void;
}

export default function ApplicationsStep({ stepKey, eventId, eventName, forms, refreshPreview }: Props) {
  const config = APPLICATION_STEPS[stepKey];
  const api = useApplicationsApi(eventId);
  const participants = useParticipantsApi();
  const canEdit = useCan('applications.forms');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [templates, setTemplates] = useState<FormTemplateSummary[]>([]);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const addRef = useRef<HTMLButtonElement>(null);
  const list = formsOnStep(stepKey, forms.forms);
  const expanded = params.get('form');

  useEffect(() => {
    if (!canEdit) return;
    participants.templates().then((r) => setTemplates(r.data)).catch(() => setTemplates([]));
  }, [participants, canEdit]);

  /** Opens one form (or none) and keeps it in the URL, so a link and a reload land on it. */
  const expand = (formId: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (formId) next.set('form', formId);
    else next.delete('form');
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };
  const saved = () => {
    forms.reload();
    refreshPreview();
  };
  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      saved();
      setStatus(label);
    } catch (err) {
      setError((err as Error)?.message || "Couldn't save");
    } finally {
      setBusy(false);
    }
  };
  const create = async (body: NewFormBody) => {
    const form = await api.createForm(body);
    setAdding(false);
    saved();
    setStatus(`${form.name} created.`);
    expand(form.id);
  };

  if (forms.load.status === 'loading') return <LoadingFields />;
  if (forms.load.status === 'error')
    return (
      <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
        <p>Couldn&apos;t load this event&apos;s application forms: {forms.load.message}</p>
        <button type="button" onClick={forms.retry} className={`${secondaryButton} mt-3`}>
          Try again
        </button>
      </div>
    );

  const addButton = canEdit && (
    <button ref={addRef} type="button" onClick={() => setAdding(true)} className={list.length ? secondaryButton : primaryButton}>
      <Plus className="h-4 w-4" aria-hidden />
      {config.addLabel}
    </button>
  );

  return (
    <div className="space-y-4">
      <p role="status" className="sr-only">{status}</p>
      {error && (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </p>
      )}
      {list.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800 sm:p-6">
          <p className="text-sm text-gray-700 dark:text-slate-300">{config.empty}</p>
          <div className="mt-4">{addButton}</div>
        </div>
      ) : (
        <>
          <ul className="space-y-3">
            {list.map((form) => (
              <FormRow
                key={form.id}
                form={form}
                expanded={expanded === form.id}
                showPurpose={config.purposes.length > 1}
                canEdit={canEdit}
                busy={busy}
                onToggle={() => expand(expanded === form.id ? null : form.id)}
                onDelete={() => {
                  if (!window.confirm(`Delete "${form.name}"? This can't be undone.`)) return;
                  if (expanded === form.id) expand(null);
                  void act(`${form.name} deleted.`, () => api.deleteForm(form.id));
                }}
                onClose={() => void act(`${form.name} closed.`, () => api.updateForm(form.id, { status: 'CLOSED' }))}
              >
                <InlineFormEditor form={form} api={api} canEdit={canEdit} purposes={config.purposes.length > 1 ? config.purposes : null} onSaved={saved} />
              </FormRow>
            ))}
          </ul>
          {addButton}
        </>
      )}
      {adding && <AddFormDialog config={config} eventName={eventName} templates={templates} onCreate={create} onClose={() => setAdding(false)} />}
    </div>
  );
}
