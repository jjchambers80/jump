'use client';

// Content › Forms › one standing form (spec 044): Submissions (the shared
// SubmissionsTable on this form), Fields (business details + questions) and
// Settings (name, link, status, window, button label, thank-you message). The
// section lives in `?tab=` so a link, a reload and the back button keep it.

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { useOrg } from '@/components/OrgContext';
import SubmissionsTable from '@/components/applications/SubmissionsTable';
import { QuestionsCard, SettingsCard } from '@/components/applications/FormEditorCards';
import { SaveAsTemplateDialog } from '@/components/applications/TemplateDialogs';
import { useParticipantsApi } from '@/components/applications/useParticipantsApi';
import { describeError, useApplicationsApi } from '@/app/admin/events/[eventId]/applications/useApplicationsApi';
import type { AdminForm, FormTemplateSummary } from '@/lib/applications';
import { FormStatusBadge } from '../FormStatusBadge';

type Tab = 'submissions' | 'fields' | 'settings';
const TABS: { key: Tab; label: string }[] = [
  { key: 'submissions', label: 'Submissions' },
  { key: 'fields', label: 'Fields' },
  { key: 'settings', label: 'Settings' },
];
const btn =
  'inline-flex min-h-[40px] items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 text-sm font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700';

export default function StandingFormPage({ params }: { params: { formId: string } }) {
  return (
    <Suspense fallback={null}>
      <StandingForm formId={params.formId} />
    </Suspense>
  );
}

function StandingForm({ formId }: { formId: string }) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const tab: Tab = (['fields', 'settings'] as const).find((t) => t === searchParams.get('tab')) ?? 'submissions';
  const { selectedOrg, loading: orgLoading } = useOrg();
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const canEdit = role === 'ADMIN' || role === 'SYSTEM_ADMIN';
  const api = useApplicationsApi('', formId);
  const participants = useParticipantsApi();
  const [form, setForm] = useState<AdminForm | null>(null);
  const [templates, setTemplates] = useState<FormTemplateSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [savingAs, setSavingAs] = useState(false);
  const [savingBusiness, setSavingBusiness] = useState(false);
  const saveAsRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    try {
      setForm(await api.form(formId));
    } catch (err) {
      setError(describeError(err, 'Could not load the form'));
    }
  }, [api, formId]);

  useEffect(() => {
    if (!orgLoading) load();
  }, [orgLoading, load]);

  useEffect(() => {
    if (!canEdit) return;
    participants
      .templates()
      .then((r) => setTemplates(r.data))
      .catch(() => setTemplates([]));
  }, [participants, canEdit]);

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

  // The storefront form (spec 044D adds the page drawer); the slug-based path works on any host.
  const publicPath = form && selectedOrg ? `/organizations/${selectedOrg.slug}/apply/${form.slug}` : null;
  const copyLink = async () => {
    if (!publicPath) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${publicPath}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy the link. Copy it from the address bar of the public form.');
    }
  };

  const toggleBusiness = async (collectBusiness: boolean) => {
    if (!form || savingBusiness) return;
    setSavingBusiness(true);
    await run(collectBusiness ? 'Business details are asked again.' : 'Business details are no longer asked.', () => api.updateForm(form.id, { collectBusiness }));
    setSavingBusiness(false);
  };

  const tabHref = (key: Tab) => {
    const next = new URLSearchParams(searchParams.toString());
    if (key === 'submissions') next.delete('tab');
    else next.set('tab', key);
    // Submission filters belong to the Submissions section only.
    if (key !== 'submissions') for (const k of ['form', 'status', 'tag', 'q', 'sort', 'page']) next.delete(k);
    const qs = next.toString();
    return `${pathname}${qs ? `?${qs}` : ''}`;
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <Link href="/admin/content/forms" className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-300">
        ← All forms
      </Link>

      <header className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-2xl font-bold text-gray-900 dark:text-white">{form?.name ?? 'Form'}</h1>
            {form && <FormStatusBadge status={form.status} />}
          </div>
          {form && (
            <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
              <span className="font-mono text-xs">/{form.slug}</span> · <span className="tabular-nums">{form.applicationCount}</span> {form.applicationCount === 1 ? 'submission' : 'submissions'}
            </p>
          )}
        </div>
        {form && (
          <div className="flex flex-wrap gap-2">
            {publicPath && form.status !== 'DRAFT' && (
              <>
                <button type="button" onClick={copyLink} className={btn} data-testid="form-copy-link">
                  {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
                  {copied ? 'Copied' : 'Copy link'}
                </button>
                <a href={publicPath} target="_blank" rel="noreferrer" className={btn}>
                  <ExternalLink className="h-4 w-4" aria-hidden />
                  View form<span className="sr-only"> (opens in a new tab)</span>
                </a>
              </>
            )}
            {canEdit && (
              <button ref={saveAsRef} type="button" className={btn} onClick={() => setSavingAs(true)} data-testid="form-save-as-template">
                Save as template
              </button>
            )}
          </div>
        )}
      </header>
      <span className="sr-only" role="status">
        {copied ? 'Link copied' : ''}
      </span>

      <nav aria-label="Form sections" className="mt-6 border-b border-gray-200 dark:border-slate-700">
        <ul className="-mb-px flex gap-1 overflow-x-auto">
          {TABS.map(({ key, label }) => (
            <li key={key}>
              <Link
                href={tabHref(key)}
                replace
                scroll={false}
                aria-current={tab === key ? 'page' : undefined}
                className={`inline-flex min-h-[44px] items-center border-b-2 px-3 text-sm font-medium ${
                  tab === key
                    ? 'border-indigo-600 text-indigo-700 dark:border-indigo-400 dark:text-indigo-300'
                    : 'border-transparent text-gray-600 hover:border-gray-300 hover:text-gray-900 dark:text-slate-400 dark:hover:text-white'
                }`}
                data-testid={`form-tab-${key}`}
              >
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

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

      <div className="mt-6">
        {tab === 'submissions' && <SubmissionsTable standingFormId={formId} />}

        {form && tab === 'fields' && (
          <div className="space-y-6">
            <section aria-labelledby="business-heading" className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-5">
              <h2 id="business-heading" className="text-base font-semibold text-gray-900 dark:text-white">
                Business details
              </h2>
              <label className="mt-3 flex items-start gap-3 text-sm text-gray-800 dark:text-slate-200">
                <input
                  type="checkbox"
                  checked={form.collectBusiness !== false}
                  disabled={!canEdit || savingBusiness}
                  onChange={(e) => toggleBusiness(e.target.checked)}
                  className="mt-0.5 h-4 w-4"
                  data-testid="form-collect-business"
                />
                <span>
                  <span className="block font-medium">Ask for business details</span>
                  <span className="block text-gray-600 dark:text-slate-400">
                    Business name, description, website, social links and photos — what you need to review a vendor. Turn it off for press, volunteers or a waitlist.
                  </span>
                </span>
              </label>
            </section>
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

        {form && tab === 'settings' && (
          <SettingsCard form={form} canEdit={canEdit} onSave={(body) => run('Form settings saved.', () => api.updateForm(form.id, body))} />
        )}
      </div>

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
