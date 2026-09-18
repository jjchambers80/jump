// Admin › Event › Applications › Forms (spec 011): the event's application
// forms with status, counts and a create action (ADMIN).
'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { acceptanceLine, type AdminForm, type FormKind, type FormTemplateSummary } from '@/lib/applications';
import { useParticipantsApi } from '@/app/admin/participants/useParticipantsApi';
import ApplicationsHeader from '../ApplicationsHeader';
import { describeError, useApplicationsApi } from '../useApplicationsApi';

const card = 'rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-5';
const btn = 'rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700';
const primary = 'rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50';
const field = 'mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';

const STATUS_PILL: Record<AdminForm['status'], string> = {
  DRAFT: 'bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-slate-300',
  OPEN: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  CLOSED: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
};

export default function FormsPage({ params }: { params: { eventId: string } }) {
  const api = useApplicationsApi(params.eventId);
  const participants = useParticipantsApi();
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const canEdit = role === 'ADMIN' || role === 'SYSTEM_ADMIN';
  const [forms, setForms] = useState<AdminForm[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<FormKind>('FREE');
  const [templates, setTemplates] = useState<FormTemplateSummary[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setForms((await api.forms()).data);
    } catch (err) {
      setError(describeError(err, 'Could not load forms'));
    }
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  // Spec 019: templates the new form can start from (same kind).
  useEffect(() => {
    if (!canEdit) return;
    participants
      .templates()
      .then((r) => setTemplates(r.data))
      .catch(() => setTemplates([]));
  }, [participants, canEdit]);
  const sameKind = templates.filter((t) => t.kind === kind);
  useEffect(() => {
    if (templateId && !sameKind.some((t) => t.id === templateId)) setTemplateId('');
  }, [sameKind, templateId]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const form = await api.createForm({ kind, name: name.trim(), ...(templateId ? { templateId } : {}) });
      window.location.assign(`/admin/events/${params.eventId}/applications/forms/${form.id}`);
    } catch (err) {
      setError(describeError(err, 'Could not create the form'));
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <ApplicationsHeader eventId={params.eventId} title="Application forms" />

      {error && (
        <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="mb-4 flex justify-end">
        {canEdit && (
          <button type="button" className={primary} onClick={() => setCreating((v) => !v)} data-testid="forms-new">
            New form
          </button>
        )}
      </div>

      {creating && (
        <form onSubmit={create} className={`${card} mb-4 grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end`} data-testid="forms-create">
          <div>
            <label htmlFor="form-name" className="block text-sm font-medium text-gray-700 dark:text-slate-300">
              Name
            </label>
            <input id="form-name" required minLength={2} value={name} onChange={(e) => setName(e.target.value)} className={field} placeholder="Vendor space, Press, Panels…" />
          </div>
          <div>
            <label htmlFor="form-kind" className="block text-sm font-medium text-gray-700 dark:text-slate-300">
              Type
            </label>
            <select id="form-kind" value={kind} onChange={(e) => setKind(e.target.value as FormKind)} className={field}>
              <option value="FREE">Free (press, panels, creators)</option>
              <option value="PAID">Paid with options (vendors, sponsors)</option>
            </select>
          </div>
          {sameKind.length > 0 && (
            <div>
              <label htmlFor="form-template" className="block text-sm font-medium text-gray-700 dark:text-slate-300">
                Start from template
              </label>
              <select id="form-template" value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={field}>
                <option value="">Blank</option>
                {sameKind.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <button type="submit" disabled={saving || name.trim().length < 2} className={primary}>
            {saving ? 'Creating…' : 'Create'}
          </button>
        </form>
      )}

      {forms && forms.length === 0 && (
        <div className={card}>
          <p className="text-sm text-gray-600 dark:text-slate-400">No application forms yet. Create one for vendors, sponsors, press or panels and it appears on the public event page once open.</p>
        </div>
      )}

      <ul className="space-y-3" data-testid="forms-list">
        {forms?.map((f) => {
          const closed = acceptanceLine(f.acceptance);
          return (
            <li key={f.id} className={card} data-testid={`form-row-${f.slug}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-semibold text-gray-900 dark:text-white">{f.name}</h2>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_PILL[f.status]}`}>{f.status.charAt(0) + f.status.slice(1).toLowerCase()}</span>
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-700 dark:bg-slate-700 dark:text-slate-300">{f.kind === 'PAID' ? 'Paid' : 'Free'}</span>
                    {f.status === 'OPEN' && closed && <span className="text-xs text-amber-700 dark:text-amber-300">{closed}</span>}
                  </div>
                  <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
                    /{f.slug} · {f.questions.length} question{f.questions.length === 1 ? '' : 's'}
                    {f.kind === 'PAID' ? ` · ${f.tiers.length} tier${f.tiers.length === 1 ? '' : 's'}` : ''} · {f.applicationCount} application{f.applicationCount === 1 ? '' : 's'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Link href={`/admin/events/${params.eventId}/applications?form=${f.id}`} className={btn}>
                    Applications
                  </Link>
                  <Link href={`/admin/events/${params.eventId}/applications/forms/${f.id}`} className={btn}>
                    {canEdit ? 'Edit' : 'View'}
                  </Link>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
