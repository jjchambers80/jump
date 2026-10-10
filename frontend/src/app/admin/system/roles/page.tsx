'use client';

// System administration › Roles & permissions: what the Admin and Organizer
// member roles may see and do in every organization, and which features are
// turned off platform-wide. The backend enforces the same keys
// (backend/src/permissions/catalog.js, PermissionService). System admins always
// have full access. Access is guarded by system/layout.tsx; saving needs a
// step-up (withReauth).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { LockIcon } from 'lucide-react';
import { ReauthProvider, isReauthCancelled, useReauth } from '@/app/admin/account/useReauth';
import { systemAdminApi, type MemberRoleKey, type RoleMatrix } from '@/services/api';
import { cardClass, errorMessage, primaryBtn, secondaryBtn } from '@/app/admin/settings/users/shared';

const ROLES: { key: MemberRoleKey; label: string }[] = [
  { key: 'ADMIN', label: 'Admin' },
  { key: 'ORGANIZER', label: 'Organizer' },
];
const switchBase =
  'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-800';
const thumb = 'block h-5 w-5 transform rounded-full bg-white shadow transition-transform motion-reduce:transition-none';
const th = 'px-3 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-slate-400';
const checkbox = 'h-4 w-4 rounded border-gray-300 text-accent-600 focus:ring-accent-500 disabled:opacity-40 dark:border-slate-600';

type Draft = { roles: RoleMatrix['roles']; disabled: string[] };

const clone = (d: Draft): Draft => ({
  roles: { ADMIN: { ...d.roles.ADMIN }, ORGANIZER: { ...d.roles.ORGANIZER } },
  disabled: [...d.disabled],
});

function countChanges(a: Draft, b: Draft) {
  let n = 0;
  for (const { key } of ROLES) for (const k of Object.keys(a.roles[key])) if (a.roles[key][k] !== b.roles[key][k]) n++;
  const sa = new Set(a.disabled);
  const sb = new Set(b.disabled);
  for (const k of new Set([...sa, ...sb])) if (sa.has(k) !== sb.has(k)) n++;
  return n;
}

function RolesPage() {
  const { withReauth } = useReauth();
  const [matrix, setMatrix] = useState<RoleMatrix | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const m = await systemAdminApi.roles();
      setMatrix(m);
      setDraft(clone(m));
    } catch (e) {
      setError(errorMessage(e, 'Could not load roles.'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const changes = useMemo(() => (matrix && draft ? countChanges(matrix, draft) : 0), [matrix, draft]);

  const setValue = (role: MemberRoleKey, key: string, value: boolean) =>
    setDraft((d) => d && { ...d, roles: { ...d.roles, [role]: { ...d.roles[role], [key]: value } } });

  const toggleFeature = (key: string, label: string) => {
    if (!draft) return;
    const off = draft.disabled.includes(key);
    if (!off && !window.confirm(`Turn off ${label} for every organization? It disappears for all staff, Admins included, until it is turned back on here.`)) return;
    setDraft({ ...draft, disabled: off ? draft.disabled.filter((k) => k !== key) : [...draft.disabled, key] });
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const m = await withReauth(() => systemAdminApi.saveRoles(draft));
      setMatrix(m);
      setDraft(clone(m));
      setNotice('Roles saved. Staff see the change within a minute.');
    } catch (e) {
      if (!isReauthCancelled(e)) setError(errorMessage(e, 'Could not save roles.'));
    } finally {
      setSaving(false);
    }
  };

  const resetToDefaults = () => {
    if (!matrix || !draft) return;
    setDraft({ roles: clone({ roles: matrix.defaults, disabled: [] }).roles, disabled: draft.disabled });
  };

  return (
    <div className="mx-auto max-w-6xl px-4 pt-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Roles &amp; permissions</h1>
      <p className="mt-1 max-w-3xl text-sm text-gray-600 dark:text-slate-400">
        What Admins and Organizers can see and do in every organization. Organizations choose who has which role
        under Settings › Users. System admins always have full access.
      </p>
      {error && (
        <p role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </p>
      )}
      <p role="status" aria-live="polite" className="sr-only">
        {notice}
      </p>
      {notice && (
        <p className="mt-4 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800 dark:border-green-900 dark:bg-green-950/40 dark:text-green-200">
          {notice}
        </p>
      )}

      {!matrix || !draft ? (
        !error && <div className="mt-8 h-96 animate-pulse rounded-xl bg-gray-100 dark:bg-slate-800" aria-busy="true" aria-label="Loading roles" />
      ) : (
        <div className="mt-8 space-y-6">
          <section className={`${cardClass} !p-0`} aria-labelledby="permissions-heading">
            <div className="px-4 pt-4 sm:px-5 sm:pt-5">
              <h2 id="permissions-heading" className="text-lg font-semibold text-gray-900 dark:text-white">
                Permissions
              </h2>
              <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
                Clearing a feature hides it from that role&apos;s menu and closes its pages. Items with a lock keep the
                admin working and cannot change.
              </p>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-y border-gray-200 bg-gray-50 dark:border-slate-700 dark:bg-slate-900/40">
                  <tr>
                    <th scope="col" className={`${th} sm:pl-5`}>
                      Feature / permission
                    </th>
                    {ROLES.map((r) => (
                      <th key={r.key} scope="col" className={`${th} w-20 text-center sm:w-24`}>
                        {r.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                {matrix.features.map((f) => {
                  const off = draft.disabled.includes(f.key);
                  return (
                    <tbody key={f.key} className="border-b border-gray-100 last:border-0 dark:border-slate-700/60">
                      <tr className="bg-white dark:bg-slate-800">
                        <th scope="row" className="px-3 py-2.5 text-left font-semibold text-gray-900 dark:text-white sm:pl-5">
                          {f.label}
                          {off && (
                            <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-700 dark:bg-slate-700 dark:text-slate-200">
                              Off for everyone
                            </span>
                          )}
                        </th>
                        {ROLES.map((r) => (
                          <td key={r.key} className="px-3 py-2.5 text-center">
                            {f.locked ? (
                              <LockIcon role="img" className="mx-auto h-4 w-4 text-gray-400" aria-label={`${f.label}: always visible to ${r.label}s`} />
                            ) : (
                              <input
                                type="checkbox"
                                className={checkbox}
                                checked={draft.roles[r.key][f.key]}
                                disabled={off}
                                onChange={(e) => setValue(r.key, f.key, e.target.checked)}
                                aria-label={`${r.label}s can see ${f.label}`}
                              />
                            )}
                          </td>
                        ))}
                      </tr>
                      {f.actions.map((a) => (
                        <tr key={a.key}>
                          <th scope="row" className="py-2 pl-7 pr-3 text-left font-normal text-gray-700 dark:text-slate-300 sm:pl-9">
                            {a.label}
                          </th>
                          {ROLES.map((r) => {
                            const hidden = !f.locked && (off || !draft.roles[r.key][f.key]);
                            return (
                              <td key={r.key} className="px-3 py-2 text-center">
                                {a.locked?.[r.key] ? (
                                  <span className="inline-flex items-center gap-1" title="Fixed so an organization always has someone who can manage users">
                                    <input type="checkbox" className={checkbox} checked={draft.roles[r.key][a.key]} disabled readOnly aria-label={`${r.label}s: ${a.label} (fixed)`} />
                                    <LockIcon className="h-3.5 w-3.5 text-gray-400" aria-hidden />
                                  </span>
                                ) : (
                                  <input
                                    type="checkbox"
                                    className={checkbox}
                                    checked={draft.roles[r.key][a.key]}
                                    disabled={hidden}
                                    onChange={(e) => setValue(r.key, a.key, e.target.checked)}
                                    aria-label={`${r.label}s: ${a.label}`}
                                  />
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  );
                })}
              </table>
            </div>
          </section>

          <section className={cardClass} aria-labelledby="platform-heading">
            <h2 id="platform-heading" className="text-lg font-semibold text-gray-900 dark:text-white">
              Platform features
            </h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
              Turn a feature off for every organization, for example before it launches or while it is being fixed.
            </p>
            <ul className="mt-4 divide-y divide-gray-100 dark:divide-slate-700/60">
              {matrix.features
                .filter((f) => f.switchable)
                .map((f) => {
                  const on = !draft.disabled.includes(f.key);
                  return (
                    <li key={f.key} className="flex items-center justify-between gap-4 py-3">
                      <span id={`feature-${f.key}`} className="text-sm font-medium text-gray-900 dark:text-white">
                        {f.label}
                        <span className="ml-2 text-xs font-normal text-gray-500 dark:text-slate-400">{on ? 'On' : 'Off'}</span>
                      </span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={on}
                        aria-labelledby={`feature-${f.key}`}
                        onClick={() => toggleFeature(f.key, f.label)}
                        className={`${switchBase} ${on ? 'bg-accent-500' : 'bg-gray-200 dark:bg-slate-700'}`}
                      >
                        <span className={`${thumb} ${on ? 'translate-x-5' : 'translate-x-0.5'}`} />
                      </button>
                    </li>
                  );
                })}
            </ul>
          </section>
        </div>
      )}

      {matrix && draft && (
        <div className="sticky bottom-0 z-20 -mx-4 mt-6 border-t border-gray-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-900 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <p className="mr-auto w-full text-sm text-gray-600 dark:text-slate-400 sm:w-auto">
              {changes === 0 ? 'No unsaved changes' : `${changes} unsaved ${changes === 1 ? 'change' : 'changes'}`}
            </p>
            <button type="button" className={secondaryBtn} onClick={resetToDefaults}>
              Reset to defaults
            </button>
            <button type="button" className={secondaryBtn} disabled={changes === 0 || saving} onClick={() => setDraft(clone(matrix))}>
              Discard
            </button>
            <button type="button" className={primaryBtn} disabled={changes === 0 || saving} onClick={save}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function RolesPageWithReauth() {
  return (
    <ReauthProvider>
      <RolesPage />
    </ReauthProvider>
  );
}
