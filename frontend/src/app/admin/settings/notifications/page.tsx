// Settings › Notifications (spec 011 + spec 053): every email the system
// sends that the store can edit, one row each; a row opens a dialog with the
// subject and message. Order emails come from the spec 053 registry
// (useNotificationsApi), application emails from their own templates until
// 053-D folds them in. ADMIN edits; others view.
'use client';

import { createRef, RefObject, useCallback, useEffect, useRef, useState } from 'react';
import SettingsNav from '../SettingsNav';
import SummaryRow from '../SummaryRow';
import TemplateDialog from './TemplateDialog';
import { useNotificationsApi, type NotificationGroup, type NotificationTemplate } from './useNotificationsApi';
import { useTemplatesApi, describeError, type DigestSettings } from '@/app/admin/events/[eventId]/applications/useApplicationsApi';
import type { MessageTemplate, TemplateAction } from '@/lib/applications';
import { useCan } from '@/components/OrgContext';
import { Mail } from 'lucide-react';

const card = 'rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-5';
const list = 'mt-4 divide-y divide-gray-200 overflow-hidden rounded-lg border border-gray-200 dark:divide-slate-700 dark:border-slate-700';

type Copy = { title: string; when: string };

const EVENT_COPY: Record<TemplateAction, Copy> = {
  RECEIVED: { title: 'Application received', when: 'Sent when someone submits an application.' },
  APPROVED: { title: 'Approved', when: 'Free forms: sent on approval. Paid forms: sent once the space is paid.' },
  CHOOSE_SPACE: { title: 'Choose your space', when: 'Paid forms: sent on approval, asking the vendor to pick a space and pay.' },
  REJECTED: { title: 'Rejected', when: 'Sent when you reject an application.' },
  WAITLISTED: { title: 'Waitlisted', when: 'Sent when you move an application to the waitlist.' },
  WITHDRAWN: { title: 'Withdrawn', when: 'Sent when an application is withdrawn.' },
  PAYMENT_DUE: { title: 'Payment due', when: 'Paid forms: sent when a balance is due.' },
  ADD_ONS_CHANGED: { title: 'Add-ons changed', when: 'Paid forms: sent when you change the add-ons on an application.' },
  TIER_CHANGED: { title: 'Tier changed', when: 'Paid forms: sent when you move an application to another tier.' },
  WAIVED: { title: 'Balance waived', when: 'Paid forms: sent when you waive the balance.' },
  OFFLINE_PAID: { title: 'Payment recorded offline', when: 'Paid forms: sent when you record a payment taken outside Eventimus.' },
};

// Spec 044: standing forms (no event) have only these four emails.
const STANDING_COPY: Partial<Record<TemplateAction, Copy>> = {
  RECEIVED: { title: 'Application received', when: 'Sent when someone submits a standing form.' },
  APPROVED: { title: 'Approved', when: 'Sent when you approve a standing-form application.' },
  WAITLISTED: { title: 'Waitlisted', when: 'Sent when you move a standing-form application to the waitlist.' },
  REJECTED: { title: 'Rejected', when: 'Sent when you reject a standing-form application.' },
};

type Scope = 'EVENT' | 'STANDING';
type MergeField = { key: string; description: string };
const keyOf = (scope: Scope, action: TemplateAction) => `${scope}:${action}`;

export default function NotificationsPage() {
  const api = useTemplatesApi();
  const notificationsApi = useNotificationsApi();
  const canEdit = useCan('settings.applications');
  const canEditNotifications = useCan('settings.notifications');
  const [groups, setGroups] = useState<NotificationGroup[]>([]);
  const [templates, setTemplates] = useState<Record<Scope, MessageTemplate[]>>({ EVENT: [], STANDING: [] });
  const [mergeFields, setMergeFields] = useState<Record<Scope, MergeField[]>>({ EVENT: [], STANDING: [] });
  const [digest, setDigest] = useState<DigestSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingDigest, setSavingDigest] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState<{ scope: Scope; action: TemplateAction } | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const rowRefs = useRef<Record<string, RefObject<HTMLButtonElement>>>({});
  const refFor = (key: string) => (rowRefs.current[key] ??= createRef<HTMLButtonElement>());

  const load = useCallback(async () => {
    try {
      // Digest settings are additive (phase 3): a failure there must not hide the templates.
      const [eventRes, standingRes, d, n] = await Promise.all([
        api.list(),
        api.list('STANDING'),
        api.digest().catch(() => null),
        // Spec 053 rows are additive: a failure there must not hide the application emails.
        notificationsApi.list().catch(() => null),
      ]);
      setGroups(n?.groups ?? []);
      setTemplates({ EVENT: eventRes.data, STANDING: standingRes.data });
      setMergeFields({ EVENT: eventRes.mergeFields, STANDING: standingRes.mergeFields });
      setDigest(d);
    } catch (err) {
      setError(describeError(err, 'Could not load notifications'));
    } finally {
      setLoading(false);
    }
  }, [api, notificationsApi]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleDigest = async (enabled: boolean) => {
    const previous = digest;
    setDigest((d) => (d ? { ...d, enabled } : d));
    setSavingDigest(true);
    setError(null);
    setNotice(null);
    try {
      setDigest(await api.updateDigest(enabled));
      setNotice(enabled ? 'Daily digest on.' : 'Daily digest off.');
    } catch (err) {
      setDigest(previous);
      setError(describeError(err, 'Could not update the digest setting'));
    } finally {
      setSavingDigest(false);
    }
  };

  const copyFor = (scope: Scope, action: TemplateAction) => (scope === 'EVENT' ? EVENT_COPY : STANDING_COPY)[action] ?? { title: action, when: '' };
  const replace = (scope: Scope, t: MessageTemplate) =>
    setTemplates((prev) => ({ ...prev, [scope]: prev[scope].map((x) => (x.action === t.action ? t : x)) }));

  /** Runs a template write; true on success so the dialog can close. */
  const write = async (scope: Scope, action: TemplateAction, run: () => Promise<MessageTemplate>, done: string) => {
    setError(null);
    setNotice(null);
    try {
      replace(scope, await run());
      setNotice(`${copyFor(scope, action).title} email ${done}.`);
      return true;
    } catch (err) {
      setError(describeError(err, 'Could not save the email'));
      return false;
    }
  };

  const writeNotification = async (key: string, run: () => Promise<NotificationTemplate>, done: string) => {
    setError(null);
    setNotice(null);
    try {
      const t = await run();
      setGroups((prev) => prev.map((g) => ({ ...g, notifications: g.notifications.map((n) => (n.key === key ? t : n)) })));
      setNotice(`${t.label} email ${done}.`);
      return true;
    } catch (err) {
      setError(describeError(err, 'Could not save the email'));
      return false;
    }
  };

  const notificationSection = (group: NotificationGroup) => (
    <div key={group.key} className={card}>
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{group.label}</h3>
      <div className={list}>
        {group.notifications.map((n) => (
          <SummaryRow
            key={n.key}
            label={`Edit ${n.label} email`}
            leading={<Mail className="h-5 w-5" aria-hidden="true" />}
            primary={[n.label, !n.isDefault && 'Customized', n.optional && !n.enabled && 'Off'].filter(Boolean).join(' · ')}
            secondary={n.subject}
            buttonRef={refFor(`notification:${n.key}`)}
            onClick={() => setOpenKey(n.key)}
          />
        ))}
      </div>
    </div>
  );

  const section = (scope: Scope, title: string, description: string) => (
    <div className={card}>
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h3>
      <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">{description}</p>
      <div className={list}>
        {templates[scope].map((t) => {
          const { title: label } = copyFor(scope, t.action);
          return (
            <SummaryRow
              key={t.action}
              label={`Edit ${label} email${scope === 'STANDING' ? ' (standing forms)' : ''}`}
              leading={<Mail className="h-5 w-5" aria-hidden="true" />}
              primary={t.isDefault ? label : `${label} · Customized`}
              secondary={t.subject}
              buttonRef={refFor(keyOf(scope, t.action))}
              onClick={() => setOpen({ scope, action: t.action })}
            />
          );
        })}
      </div>
    </div>
  );

  const openTemplate = open && templates[open.scope].find((t) => t.action === open.action);
  const openNotification = openKey ? groups.flatMap((g) => g.notifications).find((n) => n.key === openKey) : undefined;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Settings</h1>
      <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">Manage your organization and business information.</p>
      <div className="mt-8 flex min-w-0 flex-col gap-6 md:flex-row md:items-start">
        <SettingsNav />
        <section aria-labelledby="notifications-heading" className="min-w-0 flex-1 space-y-4">
          <div>
            <h2 id="notifications-heading" className="text-lg font-semibold text-gray-900 dark:text-white">
              Notifications
            </h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
              Emails your store sends. Select one to edit it. You can still edit any decision email before it goes out.
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
          {loading && <div className={`${card} h-40 animate-pulse`} aria-busy="true" aria-label="Loading notifications" />}
          {!loading && groups.map(notificationSection)}
          {!loading && templates.EVENT.length > 0 && section('EVENT', 'Event applications', 'Sent to vendors, guests and volunteers who apply to an event.')}
          {!loading && templates.STANDING.length > 0 && section('STANDING', 'Standing forms', 'Sent for forms that are not part of an event (Content › Forms).')}
          {digest && (
            <div className={card} data-testid="application-digest">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Staff notifications</h3>
              <div className="mt-4 flex items-start justify-between gap-4 rounded-lg border border-gray-200 px-4 py-3.5 dark:border-slate-700">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-white">Daily application digest</p>
                  <p className="mt-0.5 text-sm text-gray-600 dark:text-slate-400">
                    One email a day to every member of this organization listing new applications, grouped by event and form. Nothing is sent on days with no submissions.
                    {digest.lastRunAt ? ` Last checked ${new Date(digest.lastRunAt).toLocaleString()}.` : ''}
                  </p>
                </div>
                <label className="flex shrink-0 items-center gap-2 text-sm font-medium text-gray-800 dark:text-slate-200">
                  <input type="checkbox" checked={digest.enabled} disabled={!canEdit || savingDigest} onChange={(e) => toggleDigest(e.target.checked)} className="h-4 w-4 rounded border-gray-300" />
                  {digest.enabled ? 'On' : 'Off'}
                </label>
              </div>
            </div>
          )}
        </section>
      </div>
      {openNotification && (
        <TemplateDialog
          key={openNotification.key}
          title={openNotification.label}
          when={openNotification.when}
          template={{ ...openNotification, enabled: openNotification.optional ? openNotification.enabled : undefined }}
          mergeFields={openNotification.mergeFields}
          blocks={openNotification.blocks}
          canEdit={canEditNotifications}
          returnFocusRef={refFor(`notification:${openNotification.key}`)}
          onClose={() => setOpenKey(null)}
          onSave={(draft) => writeNotification(openNotification.key, () => notificationsApi.update(openNotification.key, draft), 'saved')}
          onReset={() => writeNotification(openNotification.key, () => notificationsApi.reset(openNotification.key), 'reset')}
          preview={(draft) => notificationsApi.preview(openNotification.key, draft)}
          sendTest={async (draft) => (await notificationsApi.test(openNotification.key, draft)).sentTo}
        />
      )}
      {open && openTemplate && (
        <TemplateDialog
          key={keyOf(open.scope, open.action)}
          {...copyFor(open.scope, open.action)}
          template={openTemplate}
          mergeFields={mergeFields[open.scope]}
          canEdit={canEdit}
          returnFocusRef={refFor(keyOf(open.scope, open.action))}
          onClose={() => setOpen(null)}
          onSave={(draft) => write(open.scope, open.action, () => api.update(open.action, draft, open.scope === 'STANDING' ? 'STANDING' : undefined), 'saved')}
          onReset={() => write(open.scope, open.action, () => api.reset(open.action, open.scope === 'STANDING' ? 'STANDING' : undefined), 'reset')}
        />
      )}
    </div>
  );
}
