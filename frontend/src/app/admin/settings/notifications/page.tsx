// Settings › Notifications (spec 011 + spec 053): every email the system
// sends that the store can edit, one row each, grouped as the backend
// registry (backend/src/config/notifications.js) lists them; a row opens a
// dialog with the subject, message, preview and test send. ADMIN edits;
// others view.
'use client';

import { createRef, RefObject, useCallback, useEffect, useRef, useState } from 'react';
import SettingsNav from '../SettingsNav';
import SummaryRow from '../SummaryRow';
import TemplateDialog from './TemplateDialog';
import { useNotificationsApi, type NotificationGroup, type NotificationTemplate } from './useNotificationsApi';
import { useTemplatesApi, describeError, type DigestSettings } from '@/app/admin/events/[eventId]/applications/useApplicationsApi';
import { useCan } from '@/components/OrgContext';
import { Mail } from 'lucide-react';

const card = 'rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-5';
const list = 'mt-4 divide-y divide-gray-200 overflow-hidden rounded-lg border border-gray-200 dark:divide-slate-700 dark:border-slate-700';

/** Standing forms repeat the event labels ("Approved"), so their rows say which. */
const rowLabel = (group: NotificationGroup, n: NotificationTemplate) => `Edit ${n.label} email${group.key === 'standingForms' ? ' (standing forms)' : ''}`;

export default function NotificationsPage() {
  const digestApi = useTemplatesApi();
  const api = useNotificationsApi();
  const canEdit = useCan('settings.notifications');
  const [groups, setGroups] = useState<NotificationGroup[]>([]);
  const [digest, setDigest] = useState<DigestSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingDigest, setSavingDigest] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const rowRefs = useRef<Record<string, RefObject<HTMLButtonElement>>>({});
  const refFor = (key: string) => (rowRefs.current[key] ??= createRef<HTMLButtonElement>());

  const load = useCallback(async () => {
    try {
      // Digest settings are additive (spec 011 phase 3): a failure there must not hide the emails.
      const [n, d] = await Promise.all([api.list(), digestApi.digest().catch(() => null)]);
      setGroups(n.groups);
      setDigest(d);
    } catch (err) {
      setError(describeError(err, 'Could not load notifications'));
    } finally {
      setLoading(false);
    }
  }, [api, digestApi]);

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
      setDigest(await digestApi.updateDigest(enabled));
      setNotice(enabled ? 'Daily digest on.' : 'Daily digest off.');
    } catch (err) {
      setDigest(previous);
      setError(describeError(err, 'Could not update the digest setting'));
    } finally {
      setSavingDigest(false);
    }
  };

  /** Runs a template write; true on success so the dialog can close. */
  const write = async (key: string, run: () => Promise<NotificationTemplate>, done: string) => {
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

  const openGroup = openKey ? groups.find((g) => g.notifications.some((n) => n.key === openKey)) : undefined;
  const open = openGroup?.notifications.find((n) => n.key === openKey);

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
          {groups.map((group) => (
            <div key={group.key} className={card}>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{group.label}</h3>
              <div className={list}>
                {group.notifications.map((n) => (
                  <SummaryRow
                    key={n.key}
                    label={rowLabel(group, n)}
                    leading={<Mail className="h-5 w-5" aria-hidden="true" />}
                    primary={[n.label, !n.isDefault && 'Customized', n.optional && !n.enabled && 'Off'].filter(Boolean).join(' · ')}
                    secondary={n.subject}
                    buttonRef={refFor(n.key)}
                    onClick={() => setOpenKey(n.key)}
                  />
                ))}
              </div>
            </div>
          ))}
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
      {open && openGroup && (
        <TemplateDialog
          key={open.key}
          title={openGroup.key === 'standingForms' ? `${open.label} (standing forms)` : open.label}
          when={open.when}
          template={{ ...open, enabled: open.optional ? open.enabled : undefined }}
          mergeFields={open.mergeFields}
          blocks={open.blocks}
          canEdit={canEdit}
          returnFocusRef={refFor(open.key)}
          onClose={() => setOpenKey(null)}
          onSave={(draft) => write(open.key, () => api.update(open.key, draft), 'saved')}
          onReset={() => write(open.key, () => api.reset(open.key), 'reset')}
          preview={(draft) => api.preview(open.key, draft)}
          sendTest={async (draft) => (await api.test(open.key, draft)).sentTo}
        />
      )}
    </div>
  );
}
