// Admin › Event › Applications › Form editor (spec 011): settings, tiers
// (PAID, with the add-ons each offers — spec 012) and questions. Each section
// saves on its own; the public preview link opens the storefront form. The
// cards live in components/applications/FormEditorCards (shared with the
// template editor, spec 019); ADMIN can save the form as a template.
'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { type AdminForm, type FormTemplateSummary } from '@/lib/applications';
import { QuestionsCard, SettingsCard, TiersCard } from '@/components/applications/FormEditorCards';
import { SaveAsTemplateDialog } from '@/components/applications/TemplateDialogs';
import { useParticipantsApi } from '@/app/admin/participants/useParticipantsApi';
import ApplicationsHeader from '../../ApplicationsHeader';
import { describeError, useApplicationsApi } from '../../useApplicationsApi';

const btn = 'rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700';

export default function FormEditorPage({ params }: { params: { eventId: string; formId: string } }) {
  const api = useApplicationsApi(params.eventId);
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const canEdit = role === 'ADMIN' || role === 'SYSTEM_ADMIN';
  const participants = useParticipantsApi();
  const [form, setForm] = useState<AdminForm | null>(null);
  const [templates, setTemplates] = useState<FormTemplateSummary[]>([]);
  const [savingAs, setSavingAs] = useState(false);
  const saveAsRef = useRef<HTMLButtonElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setForm(await api.form(params.formId));
    } catch (err) {
      setError(describeError(err, 'Could not load the form'));
    }
  }, [api, params.formId]);

  useEffect(() => {
    load();
  }, [load]);

  // Spec 019: templates of the organization, for "Save as template" (replace) and the created-from note.
  useEffect(() => {
    if (!canEdit) return;
    participants
      .templates()
      .then((r) => setTemplates(r.data))
      .catch(() => setTemplates([]));
  }, [participants, canEdit]);
  const createdFrom = form?.createdFromTemplateId ? templates.find((t) => t.id === form.createdFromTemplateId) : null;

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setError(null);
    setNotice(null);
    try {
      await fn();
      await load();
      setNotice(label);
    } catch (err) {
      setError(describeError(err, 'Could not save'));
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <ApplicationsHeader eventId={params.eventId} title={form?.name ?? 'Form'} subtitle={form ? `${form.kind === 'PAID' ? 'Paid' : 'Free'} form · /${form.slug}` : undefined} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={`/admin/events/${params.eventId}/applications/forms`} className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-300">
          ← All forms
        </Link>
        <div className="flex items-center gap-2">
          {form && canEdit && (
            <button ref={saveAsRef} type="button" className={btn} onClick={() => setSavingAs(true)} data-testid="form-save-as-template">
              Save as template
            </button>
          )}
          {form && form.status !== 'DRAFT' && (
            <Link href={`/events/${params.eventId}/apply/${form.slug}`} target="_blank" className={btn}>
              View public form ↗
            </Link>
          )}
        </div>
      </div>
      {createdFrom && (
        <p className="mt-2 text-sm text-gray-600 dark:text-slate-400" data-testid="form-created-from">
          Created from the{' '}
          <Link href={`/admin/participants/templates/${createdFrom.id}`} className="text-indigo-600 underline dark:text-indigo-300">
            {createdFrom.name}
          </Link>{' '}
          template.
        </p>
      )}

      {error && (
        <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </div>
      )}
      {notice && (
        <p role="status" className="mt-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300">
          {notice}
        </p>
      )}

      {form && (
        <div className="mt-4 space-y-6">
          <SettingsCard form={form} canEdit={canEdit} onSave={(body) => run('Form settings saved.', () => api.updateForm(form.id, body))} />
          {form.kind === 'PAID' && (
            <TiersCard
              form={form}
              canEdit={canEdit}
              onAdd={(body) => run('Tier added.', () => api.addTier(form.id, body))}
              onUpdate={(tierId, body) => run('Tier saved.', () => api.updateTier(form.id, tierId, body))}
              onDelete={(tierId) => run('Tier deleted.', () => api.deleteTier(form.id, tierId))}
              onSetAddOns={(tierId, addOnIds) => run('Add-ons saved.', () => api.setTierAddOns(form.id, tierId, addOnIds))}
            />
          )}
          <QuestionsCard
            form={form}
            canEdit={canEdit}
            onAdd={(body) => run('Question added.', () => api.addQuestion(form.id, body))}
            onUpdate={(id, body) => run('Question saved.', () => api.updateQuestion(form.id, id, body))}
            onRemove={(id) => run('Question removed.', () => api.removeQuestion(form.id, id))}
            onReorder={(ids) => run('Order saved.', () => api.reorderQuestions(form.id, ids))}
          />
        </div>
      )}

      {savingAs && form && (
        <SaveAsTemplateDialog
          form={form}
          templates={templates}
          onSave={(body) => api.saveAsTemplate(form.id, body)}
          onSaved={async (t, replaced) => {
            setSavingAs(false);
            setNotice(replaced ? `Template "${t.name}" replaced.` : `Saved as the "${t.name}" template.`);
            setTemplates((await participants.templates()).data);
          }}
          returnFocusRef={saveAsRef}
          onClose={() => setSavingAs(false)}
        />
      )}
    </div>
  );
}
