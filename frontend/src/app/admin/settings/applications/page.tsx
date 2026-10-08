// Settings › Applications (spec 011): the decision emails applicants
// receive, one per action, with merge fields. ADMIN edits; others view.
'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import SettingsNav from '../SettingsNav';
import { fieldClass, labelClass } from '../formShared';
import { useTemplatesApi, describeError, type DigestSettings } from '@/app/admin/events/[eventId]/applications/useApplicationsApi';
import type { MessageTemplate, TemplateAction } from '@/lib/applications';

const card = 'rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-5';
const btn = 'rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700';
const primary = 'rounded-md bg-accent-500 px-3 py-1.5 text-sm font-semibold text-gray-950 hover:bg-accent-hover disabled:opacity-50';

const EVENT_ACTION_LABEL: Record<TemplateAction, string> = {
  RECEIVED: 'Application received',
  APPROVED: 'Approved (free forms; paid forms once the space is paid)',
  CHOOSE_SPACE: 'Approved: choose your space (paid forms)',
  REJECTED: 'Rejected',
  WAITLISTED: 'Waitlisted',
  WITHDRAWN: 'Withdrawn',
  PAYMENT_DUE: 'Payment due (paid forms)',
  ADD_ONS_CHANGED: 'Add-ons changed (paid forms)',
  TIER_CHANGED: 'Tier changed (paid forms)',
  WAIVED: 'Balance waived (paid forms)',
  OFFLINE_PAID: 'Payment recorded offline (paid forms)',
};

// Spec 044: standing forms (no event) have only these four emails.
const STANDING_ACTION_LABEL: Partial<Record<TemplateAction, string>> = {
  RECEIVED: 'Application received',
  APPROVED: 'Approved',
  WAITLISTED: 'Waitlisted',
  REJECTED: 'Rejected',
};
type Scope = 'EVENT' | 'STANDING';
/** Drafts and in-flight saves are per scope: both scopes have a RECEIVED template. */
const keyOf = (scope: Scope, action: TemplateAction) => `${scope}:${action}`;

export default function ApplicationTemplatesPage() {
  const api = useTemplatesApi();
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const canEdit = role === 'ADMIN' || role === 'SYSTEM_ADMIN';
  const [eventTemplates, setEventTemplates] = useState<MessageTemplate[]>([]);
  const [standingTemplates, setStandingTemplates] = useState<MessageTemplate[]>([]);
  const [eventMergeFields, setEventMergeFields] = useState<{ key: string; description: string }[]>([]);
  const [standingMergeFields, setStandingMergeFields] = useState<{ key: string; description: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { subject: string; body: string }>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [digest, setDigest] = useState<DigestSettings | null>(null);

  const load = useCallback(async () => {
    try {
      // Digest settings are additive (phase 3): a failure there must not hide the templates.
      const [eventRes, standingRes, d] = await Promise.all([
        api.list(),
        api.list('STANDING'),
        api.digest().catch(() => null),
      ]);
      setEventTemplates(eventRes.data);
      setEventMergeFields(eventRes.mergeFields);
      setStandingTemplates(standingRes.data);
      setStandingMergeFields(standingRes.mergeFields);
      setDrafts(
        Object.fromEntries(
          [
            ...eventRes.data.map((t) => [keyOf('EVENT', t.action), { subject: t.subject, body: t.body }]),
            ...standingRes.data.map((t) => [keyOf('STANDING', t.action), { subject: t.subject, body: t.body }]),
          ]
        )
      );
      setDigest(d);
    } catch (err) {
      setError(describeError(err, 'Could not load templates'));
    }
  }, [api]);

  const toggleDigest = async (enabled: boolean) => {
    const previous = digest;
    setDigest((d) => (d ? { ...d, enabled } : d));
    setSaving('digest');
    setError(null);
    setNotice(null);
    try {
      setDigest(await api.updateDigest(enabled));
      setNotice(enabled ? 'Daily digest on.' : 'Daily digest off.');
    } catch (err) {
      setDigest(previous);
      setError(describeError(err, 'Could not update the digest setting'));
    } finally {
      setSaving(null);
    }
  };

  useEffect(() => {
    load();
  }, [load]);

  const save = async (action: TemplateAction, scope: Scope) => {
    setSaving(keyOf(scope, action));
    setError(null);
    setNotice(null);
    try {
      const t = await api.update(action, drafts[keyOf(scope, action)], scope === 'STANDING' ? scope : undefined);
      if (scope === 'EVENT') {
        setEventTemplates((prev) => prev.map((x) => (x.action === action ? t : x)));
      } else {
        setStandingTemplates((prev) => prev.map((x) => (x.action === action ? t : x)));
      }
      setNotice(`${(scope === 'EVENT' ? EVENT_ACTION_LABEL : STANDING_ACTION_LABEL)[action]} template saved.`);
    } catch (err) {
      setError(describeError(err, 'Could not save the template'));
    } finally {
      setSaving(null);
    }
  };

  const reset = async (action: TemplateAction, scope: Scope) => {
    const labelMap = scope === 'EVENT' ? EVENT_ACTION_LABEL : STANDING_ACTION_LABEL;
    if (!window.confirm(`Reset the ${labelMap[action]} template to the default?`)) return;
    setSaving(keyOf(scope, action));
    try {
      const t = await api.reset(action, scope === 'STANDING' ? scope : undefined);
      if (scope === 'EVENT') {
        setEventTemplates((prev) => prev.map((x) => (x.action === action ? t : x)));
      } else {
        setStandingTemplates((prev) => prev.map((x) => (x.action === action ? t : x)));
      }
      setDrafts((prev) => ({ ...prev, [keyOf(scope, action)]: { subject: t.subject, body: t.body } }));
      setNotice(`${labelMap[action]} template reset.`);
    } catch (err) {
      setError(describeError(err, 'Could not reset the template'));
    } finally {
      setSaving(null);
    }
  };

  const renderTemplates = (
    templates: MessageTemplate[],
    mergeFields: { key: string; description: string }[],
    actionLabel: Partial<Record<TemplateAction, string>>,
    scope: Scope,
    title: string,
    mergeFieldTitle: string
  ) => (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold text-gray-900 dark:text-white">{title}</h3>
        <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
          {mergeFieldTitle}{' '}
          {mergeFields.map((m) => (
            <code key={m.key} title={m.description} className="mr-1 rounded bg-gray-100 px-1 py-0.5 text-xs dark:bg-slate-700">
              {`{{${m.key}}}`}
            </code>
          ))}
        </p>
      </div>
      {templates.map((t) => {
        const key = keyOf(scope, t.action);
        const d = drafts[key] ?? { subject: t.subject, body: t.body };
        // Event testids stay `template-<ACTION>` (existing specs); standing ones are prefixed.
        const testId = scope === 'EVENT' ? `template-${t.action}` : `template-standing-${t.action}`;
        const dirty = d.subject !== t.subject || d.body !== t.body;
        return (
          <div key={`${scope}-${t.action}`} className={card} data-testid={testId}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-base font-semibold text-gray-900 dark:text-white">{actionLabel[t.action]}</h4>
              <span className="text-xs text-gray-500 dark:text-slate-400">{t.isDefault ? 'Default' : 'Customised'}</span>
            </div>
            <label htmlFor={`subject-${scope}-${t.action}`} className={`${labelClass} mt-3`}>
              Subject
            </label>
            <input
              id={`subject-${scope}-${t.action}`}
              value={d.subject}
              disabled={!canEdit}
              onChange={(e) => setDrafts({ ...drafts, [key]: { ...d, subject: e.target.value } })}
              className={fieldClass}
            />
            <label htmlFor={`body-${scope}-${t.action}`} className={`${labelClass} mt-3`}>
              Message
            </label>
            <textarea
              id={`body-${scope}-${t.action}`}
              rows={8}
              value={d.body}
              disabled={!canEdit}
              onChange={(e) => setDrafts({ ...drafts, [key]: { ...d, body: e.target.value } })}
              className={`${fieldClass} font-mono text-xs`}
            />
            {canEdit && (
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  className={primary}
                  disabled={!dirty || saving === key}
                  onClick={() => save(t.action, scope)}
                >
                  {saving === key ? 'Saving…' : 'Save'}
                </button>
                {!t.isDefault && (
                  <button type="button" className={btn} disabled={saving === key} onClick={() => reset(t.action, scope)}>
                    Reset to default
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Settings</h1>
      <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">Manage your organization and business information.</p>
      <div className="mt-8 flex min-w-0 flex-col gap-6 md:flex-row md:items-start">
        <SettingsNav />
        <section aria-labelledby="applications-heading" className="min-w-0 flex-1 space-y-6">
          <div>
            <h2 id="applications-heading" className="text-lg font-semibold text-gray-900 dark:text-white">
              Application emails
            </h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
              Sent when you decide on an application. You can still edit any message before it goes out.
            </p>
          </div>
          {error && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
              {error}
            </div>
          )}
          {notice && (
            <p role="status" className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300">
              {notice}
            </p>
          )}
          {digest && (
            <div className={card} data-testid="application-digest">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-gray-900 dark:text-white">Daily digest</h3>
                  <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
                    One email a day to every member of this organization listing new applications, grouped by event and form. Nothing is sent on days with no submissions.
                    {digest.lastRunAt ? ` Last checked ${new Date(digest.lastRunAt).toLocaleString()}.` : ''}
                  </p>
                </div>
                <label className="flex items-center gap-2 text-sm font-medium text-gray-800 dark:text-slate-200">
                  <input type="checkbox" checked={digest.enabled} disabled={!canEdit || saving === 'digest'} onChange={(e) => toggleDigest(e.target.checked)} className="h-4 w-4 rounded border-gray-300" />
                  {digest.enabled ? 'On' : 'Off'}
                </label>
              </div>
            </div>
          )}
          {renderTemplates(eventTemplates, eventMergeFields, EVENT_ACTION_LABEL, 'EVENT', 'Event application forms', 'Merge fields:')}
          {renderTemplates(standingTemplates, standingMergeFields, STANDING_ACTION_LABEL, 'STANDING', 'Content › Forms', 'For forms that are not part of an event. Merge fields:')}
        </section>
      </div>
    </div>
  );
}
