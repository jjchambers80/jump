// Admin › Participants › Applications (spec 019 phase 2): every application
// form across the organization's events, and the reusable templates a new
// form can start from. ADMIN creates forms (on any upcoming event) and
// templates here; ORGANIZER reads.
'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useOrg } from '@/components/OrgContext';
import { formatDate, type FormTemplateSummary, type OrgForm } from '@/lib/applications';
import { describeError } from '@/app/admin/events/[eventId]/applications/useApplicationsApi';
import { NewApplicationDialog, NewTemplateDialog } from '@/components/applications/TemplateDialogs';
import ParticipantsHeader from '../ParticipantsHeader';
import { useParticipantsApi } from '../useParticipantsApi';
import { formatEventDate } from '@/lib/eventTime';

const FORM_STATUS_STYLE: Record<OrgForm['status'], string> = {
  DRAFT: 'bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-slate-200',
  OPEN: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  CLOSED: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
};
const primary = 'rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50';
const btn = 'rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700';
const card = 'rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800';

export default function ParticipantsApplicationsPage() {
  const api = useParticipantsApi();
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const canEdit = role === 'ADMIN' || role === 'SYSTEM_ADMIN';
  const { organizations, selectedOrgId } = useOrg();
  const [forms, setForms] = useState<OrgForm[] | null>(null);
  const [templates, setTemplates] = useState<FormTemplateSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'application' | 'template' | null>(null);
  const newApplicationRef = useRef<HTMLButtonElement>(null);
  const newTemplateRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    setError(null);
    const [f, t] = await Promise.allSettled([api.forms(), api.templates()]);
    if (f.status === 'fulfilled') setForms(f.value.data);
    else setError(describeError(f.reason, 'Could not load application forms'));
    if (t.status === 'fulfilled') setTemplates(t.value.data);
    else setError((prev) => prev ?? describeError(t.reason, 'Could not load templates'));
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  // Events offered by New application: every organization for SYSTEM_ADMIN, the active one for members.
  const pickerOrgs = useMemo(() => {
    const list = role === 'SYSTEM_ADMIN' ? organizations : organizations.filter((o) => o.id === selectedOrgId);
    return list.map((o) => ({ id: o.id, name: o.name }));
  }, [role, organizations, selectedOrgId]);

  const deleteTemplate = async (t: FormTemplateSummary) => {
    if (!window.confirm(`Delete the "${t.name}" template? Forms already created from it are kept.`)) return;
    setError(null);
    try {
      await api.deleteTemplate(t.id);
      setNotice(`Template "${t.name}" deleted.`);
      await load();
    } catch (err) {
      setError(describeError(err, 'Could not delete the template'));
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <ParticipantsHeader />
      {error && (
        <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </div>
      )}
      {notice && (
        <p role="status" className="mb-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300">
          {notice}
        </p>
      )}

      {/* Application forms */}
      <section aria-labelledby="forms-heading" className="mb-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id="forms-heading" className="text-lg font-semibold text-gray-900 dark:text-white">
            Application forms
          </h2>
          {canEdit && (
            <button ref={newApplicationRef} type="button" className={primary} onClick={() => setDialog('application')} data-testid="participants-new-application">
              New application
            </button>
          )}
        </div>
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-slate-700" data-testid="participants-forms-table">
            <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 dark:bg-slate-900/40 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2">Event</th>
                <th className="px-3 py-2">Form</th>
                <th className="px-3 py-2">Kind</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Submissions</th>
                <th className="px-3 py-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
              {forms?.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-gray-600 dark:text-slate-400">
                    No application forms yet.{' '}
                    {canEdit ? (
                      'Use New application to add one to an upcoming event.'
                    ) : (
                      <>
                        Open an event under{' '}
                        <Link href="/admin/events" className="text-indigo-600 hover:underline dark:text-indigo-300">
                          Events
                        </Link>{' '}
                        to see its forms.
                      </>
                    )}
                  </td>
                </tr>
              )}
              {forms?.map((f) => (
                <tr key={f.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/40" data-testid={`participants-form-${f.id}`}>
                  <td className="px-3 py-2 text-gray-800 dark:text-slate-200">
                    {f.event.name}
                    <div className="text-xs text-gray-600 dark:text-slate-400">{formatEventDate(f.event.date, f.event.timezone)}</div>
                    {f.organization && <div className="text-xs text-gray-500 dark:text-slate-500">{f.organization.name}</div>}
                  </td>
                  <td className="px-3 py-2 font-medium text-gray-900 dark:text-white">{f.name}</td>
                  <td className="px-3 py-2 text-gray-700 dark:text-slate-300">{f.kind === 'PAID' ? 'Paid' : 'Free'}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${FORM_STATUS_STYLE[f.status]}`}>{f.status === 'OPEN' ? 'Open' : f.status === 'CLOSED' ? 'Closed' : 'Draft'}</span>
                  </td>
                  <td className="px-3 py-2">
                    <Link href={`/admin/participants?event=${f.eventId}&form=${f.id}`} className="text-indigo-600 hover:underline dark:text-indigo-300">
                      {f.applicationCount} {f.applicationCount === 1 ? 'submission' : 'submissions'}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link href={`/admin/events/${f.eventId}/applications/forms/${f.id}`} className="text-indigo-600 hover:underline dark:text-indigo-300">
                      {canEdit ? 'Edit' : 'View'}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Templates */}
      <section aria-labelledby="templates-heading">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 id="templates-heading" className="text-lg font-semibold text-gray-900 dark:text-white">
              Templates
            </h2>
            <p className="text-sm text-gray-600 dark:text-slate-400">Reusable settings, options and questions. A new application can start from one; editing a template never changes forms already created from it.</p>
          </div>
          {canEdit && (
            <button ref={newTemplateRef} type="button" className={btn} onClick={() => setDialog('template')} data-testid="participants-new-template">
              New template
            </button>
          )}
        </div>
        {templates.length === 0 ? (
          <div className={card}>
            <p className="text-sm text-gray-600 dark:text-slate-400">
              No templates yet.{canEdit ? ' Create one here, or open a form and choose Save as template.' : ''}
            </p>
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="participants-templates">
            {templates.map((t) => (
              <li key={t.id} className={card} data-testid={`participants-template-${t.id}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link href={`/admin/participants/templates/${t.id}`} className="font-semibold text-gray-900 hover:underline dark:text-white">
                      {t.name}
                    </Link>
                    <p className="mt-1 text-xs text-gray-600 dark:text-slate-400">
                      {t.kind === 'PAID' ? 'Paid' : 'Free'}
                      {t.kind === 'PAID' ? ` · ${t.tierCount} option${t.tierCount === 1 ? '' : 's'}` : ''} · {t.questionCount} question{t.questionCount === 1 ? '' : 's'} · updated {formatDate(t.updatedAt)}
                    </p>
                    {t.organization && <p className="text-xs text-gray-500 dark:text-slate-500">{t.organization.name}</p>}
                  </div>
                  {canEdit && (
                    <button type="button" className="text-sm font-medium text-red-700 hover:underline dark:text-red-300" onClick={() => deleteTemplate(t)}>
                      Delete
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {dialog === 'application' && <NewApplicationDialog organizationIds={pickerOrgs} templates={templates} returnFocusRef={newApplicationRef} onClose={() => setDialog(null)} />}
      {dialog === 'template' && <NewTemplateDialog returnFocusRef={newTemplateRef} onClose={() => setDialog(null)} />}
    </div>
  );
}
