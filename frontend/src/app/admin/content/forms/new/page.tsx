'use client';

// Content › Forms › New form (spec 044): a name and where to start — blank, or
// one of the organization's FREE templates (the same templates event forms use).
// Standing forms are always FREE: no tiers, no payment.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import api from '@/services/api';
import { useOrg } from '@/components/OrgContext';
import { useParticipantsApi } from '@/components/applications/useParticipantsApi';
import type { AdminForm, FormTemplateSummary } from '@/lib/applications';

const field = 'mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';
const choice =
  'flex cursor-pointer items-start gap-3 rounded-lg border border-gray-200 p-3.5 text-sm has-[:checked]:border-indigo-500 has-[:checked]:bg-indigo-50/60 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-indigo-500 dark:border-slate-700 dark:has-[:checked]:bg-indigo-900/20';

export default function NewFormPage() {
  const router = useRouter();
  const { selectedOrgId } = useOrg();
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const canEdit = role === 'ADMIN' || role === 'SYSTEM_ADMIN';
  const participants = useParticipantsApi();
  const [name, setName] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [templates, setTemplates] = useState<FormTemplateSummary[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!selectedOrgId) return;
    participants
      .templates()
      .then((r) => setTemplates(r.data.filter((t) => t.kind === 'FREE')))
      .catch(() => setTemplates([]));
  }, [participants, selectedOrgId]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (!name.trim()) {
      setError('Give the form a name.');
      nameRef.current?.focus();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const form = await api.post<AdminForm>('/admin/standing-application-forms', { name: name.trim(), ...(templateId && { templateId }) });
      router.push(`/admin/content/forms/${form.id}?tab=fields`);
    } catch (err) {
      setError((err as Error)?.message || 'Could not create the form');
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <Link href="/admin/content/forms" className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-300">
        ← All forms
      </Link>
      <h1 className="mt-3 text-2xl font-bold text-gray-900 dark:text-white">New form</h1>
      <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">An always-on form, like “Become a vendor”. You add questions next, then open it and put it on a page.</p>

      {!canEdit ? (
        <p className="mt-6 rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">Only admins can create forms.</p>
      ) : (
        <form onSubmit={submit} noValidate className="mt-6 space-y-6">
          {error && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
              {error}
            </div>
          )}
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-5">
            <label htmlFor="new-form-name" className="block text-sm font-medium text-gray-700 dark:text-slate-300">
              Name
            </label>
            <input
              ref={nameRef}
              id="new-form-name"
              value={name}
              maxLength={120}
              required
              aria-invalid={error && !name.trim() ? true : undefined}
              onChange={(e) => setName(e.target.value)}
              placeholder="Become a vendor"
              className={field}
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">Applicants see this name. The link is made from it; you can change it in Settings.</p>
          </div>

          <fieldset className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-5">
            <legend className="text-sm font-medium text-gray-700 dark:text-slate-300">Start from</legend>
            <div className="mt-2 space-y-2">
              <label className={choice} data-testid="start-from-blank">
                <input type="radio" name="start-from" checked={!templateId} onChange={() => setTemplateId('')} className="mt-0.5" />
                <span>
                  <span className="block font-medium text-gray-900 dark:text-white">Blank</span>
                  <span className="block text-gray-600 dark:text-slate-400">Name, email and business details, plus any questions you add.</span>
                </span>
              </label>
              {templates.map((t) => (
                <label key={t.id} className={choice} data-testid={`start-from-${t.id}`}>
                  <input type="radio" name="start-from" checked={templateId === t.id} onChange={() => setTemplateId(t.id)} className="mt-0.5" />
                  <span>
                    <span className="block font-medium text-gray-900 dark:text-white">{t.name}</span>
                    <span className="block text-gray-600 dark:text-slate-400">
                      Template · {t.questionCount} {t.questionCount === 1 ? 'question' : 'questions'}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Link href="/admin/content/forms" className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-gray-300 bg-white px-4 text-sm font-semibold text-gray-800 hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
              Cancel
            </Link>
            <button type="submit" disabled={saving} className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
              {saving ? 'Creating…' : 'Create form'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
