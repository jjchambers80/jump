// Admin › Participants › Template editor (spec 019 phase 2): the form editor
// cards mounted on a local definition. Tiers and questions get synthetic ids
// so the cards' editing state works; Save PUTs the whole definition.
'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { QuestionsCard, SettingsCard, TiersCard, type EditorForm } from '@/components/applications/FormEditorCards';
import { formatDate, type FormTemplate, type Question, type TemplateDefinition, type TemplateQuestion, type TemplateTier } from '@/lib/applications';
import { describeError } from '@/app/admin/events/[eventId]/applications/useApplicationsApi';
import ParticipantsHeader from '../../ParticipantsHeader';
import { useParticipantsApi } from '../../useParticipantsApi';

const primary = 'rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50';

/** Definition tiers / questions carry no ids; the cards need stable ones for their edit state. */
function toEditorForm(template: FormTemplate, name: string, definition: TemplateDefinition): EditorForm {
  return {
    id: template.id,
    kind: template.kind,
    name,
    intro: definition.intro,
    chargeTiming: definition.chargeTiming ?? 'APPROVAL',
    feeMode: definition.feeMode ?? 'PASS',
    taxable: definition.taxable ?? false,
    paymentDueDays: definition.paymentDueDays ?? 7,
    overduePolicy: definition.overduePolicy ?? 'WITHDRAW',
    tiers: definition.tiers.map((t, i) => ({ id: `t${i}`, ...t })),
    questions: definition.questions.map((q, i): Question => ({ id: `q${i}`, displayOrder: i, ...q })),
  };
}

const index = (id: string) => Number(id.slice(1));

function tierFromBody(body: Record<string, unknown>, existing?: TemplateTier): TemplateTier {
  return {
    name: String(body.name ?? existing?.name ?? ''),
    description: (body.description as string | null | undefined) ?? existing?.description ?? null,
    price: Number(body.price ?? existing?.price ?? 0),
    quantityTotal: Number(body.quantityTotal ?? existing?.quantityTotal ?? 0),
    isActive: body.isActive === undefined ? existing?.isActive ?? true : Boolean(body.isActive),
  };
}

function questionFromBody(body: Record<string, unknown>): TemplateQuestion {
  return {
    label: String(body.label ?? ''),
    helpText: (body.helpText as string | null | undefined) ?? null,
    type: body.type as TemplateQuestion['type'],
    required: body.required === true,
    options: Array.isArray(body.options) ? (body.options as string[]) : [],
    pinned: body.pinned === true,
  };
}

export default function TemplateEditorPage({ params }: { params: { templateId: string } }) {
  const api = useParticipantsApi();
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const canEdit = role === 'ADMIN' || role === 'SYSTEM_ADMIN';
  const [template, setTemplate] = useState<FormTemplate | null>(null);
  const [name, setName] = useState('');
  const [definition, setDefinition] = useState<TemplateDefinition | null>(null);
  const [saved, setSaved] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const t = await api.template(params.templateId);
      setTemplate(t);
      setName(t.name);
      setDefinition(t.definition);
      setSaved(JSON.stringify({ name: t.name, definition: t.definition }));
    } catch (err) {
      setError(describeError(err, 'Could not load the template'));
    }
  }, [api, params.templateId]);

  useEffect(() => {
    load();
  }, [load]);

  const dirty = definition !== null && JSON.stringify({ name, definition }) !== saved;

  // Unsaved-changes guard on navigation away.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const editorForm = useMemo(() => (template && definition ? toEditorForm(template, name, definition) : null), [template, name, definition]);

  const patch = (fn: (d: TemplateDefinition) => TemplateDefinition) => setDefinition((d) => (d ? fn(d) : d));

  const save = async () => {
    if (!definition || saving || !dirty) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const t = await api.updateTemplate(params.templateId, { name: name.trim(), definition });
      setTemplate(t);
      setName(t.name);
      setDefinition(t.definition);
      setSaved(JSON.stringify({ name: t.name, definition: t.definition }));
      setNotice('Template saved.');
    } catch (err) {
      setError(describeError(err, 'Could not save the template'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <ParticipantsHeader />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link href="/admin/participants/applications" className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-300">
            ← Applications
          </Link>
          {template && (
            <p className="mt-1 text-sm text-gray-600 dark:text-slate-400" data-testid="template-subtitle">
              {template.kind === 'PAID' ? 'Paid' : 'Free'} template · updated {formatDate(template.updatedAt)}
            </p>
          )}
        </div>
        {canEdit && (
          <button type="button" className={primary} disabled={!dirty || saving} onClick={save} data-testid="template-save">
            {saving ? 'Saving…' : dirty ? 'Save template' : 'Saved'}
          </button>
        )}
      </div>

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

      {editorForm && definition && (
        <div className="mt-4 space-y-6">
          <SettingsCard
            form={editorForm}
            canEdit={canEdit}
            mode="template"
            onChange={(settings) => {
              setName(String(settings.name ?? ''));
              patch((d) => ({
                ...d,
                intro: (settings.intro as string | null) ?? null,
                ...(template?.kind === 'PAID'
                  ? {
                      chargeTiming: settings.chargeTiming as TemplateDefinition['chargeTiming'],
                      feeMode: settings.feeMode as TemplateDefinition['feeMode'],
                      taxable: Boolean(settings.taxable),
                      paymentDueDays: Number(settings.paymentDueDays),
                      overduePolicy: settings.overduePolicy as TemplateDefinition['overduePolicy'],
                    }
                  : {}),
              }));
            }}
          />
          {template?.kind === 'PAID' && (
            <TiersCard
              form={editorForm}
              canEdit={canEdit}
              mode="template"
              onAdd={async (body) => patch((d) => ({ ...d, tiers: [...d.tiers, tierFromBody(body)] }))}
              onUpdate={async (tierId, body) => patch((d) => ({ ...d, tiers: d.tiers.map((t, i) => (i === index(tierId) ? tierFromBody(body, t) : t)) }))}
              onDelete={async (tierId) => patch((d) => ({ ...d, tiers: d.tiers.filter((_, i) => i !== index(tierId)) }))}
            />
          )}
          <QuestionsCard
            form={editorForm}
            canEdit={canEdit}
            mode="template"
            onAdd={async (body) => patch((d) => ({ ...d, questions: [...d.questions, questionFromBody(body)] }))}
            onUpdate={async (id, body) => patch((d) => ({ ...d, questions: d.questions.map((q, i) => (i === index(id) ? questionFromBody(body) : q)) }))}
            onRemove={async (id) => patch((d) => ({ ...d, questions: d.questions.filter((_, i) => i !== index(id)) }))}
            onReorder={async (ids) => patch((d) => ({ ...d, questions: ids.map((id) => d.questions[index(id)]) }))}
          />
        </div>
      )}
    </div>
  );
}
