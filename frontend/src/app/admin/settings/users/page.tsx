// Settings › Users — the staff of the active organization.
// Lives under Settings alongside General and Domains; /admin/users redirects
// here (next.config.mjs). ADMIN/SYSTEM_ADMIN only (SettingsNav hides the link
// for other roles; the backend also checks the role in *this* organization).
// Add users → /admin/settings/users/new. A member reads Pending until their
// first sign-in.

'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useCan } from '@/components/OrgContext';
import { useOrg } from '@/components/OrgContext';
import { membersApi, type MemberRole, type MemberStatus, type OrgMember } from '@/services/api';
import { ShieldIcon, UsersIcon } from '../icons';
import { FLASH_KEY, MemberStatusPill, ROLE_LABEL, SettingsShell, errorMessage, primaryBtn } from './shared';

const FILTERS: { value: MemberStatus | ''; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'PENDING', label: 'Pending' },
];

const grid = 'xl:grid-cols-[minmax(0,2fr)_minmax(0,1.6fr)_8rem_14rem]';
const th = 'px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-slate-400';
const linkBtn =
  'min-h-[44px] rounded px-1.5 py-1 text-sm font-semibold text-accent-700 sm:min-h-0 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 disabled:opacity-50 dark:text-accent-300';
const dangerBtn =
  'min-h-[44px] rounded px-1.5 py-1 text-sm font-semibold text-red-700 sm:min-h-0 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:opacity-50 dark:text-red-400';

export default function UsersPage() {
  const canManage = useCan('settings.users');

  if (!canManage) {
    return (
      <SettingsShell>
        <section className="min-w-0 flex-1 px-4 py-16 text-center">
          <h2 className="mb-2 text-2xl font-bold text-gray-900 dark:text-white">Access denied</h2>
          <p className="text-gray-600 dark:text-slate-400">Your role in this organization cannot manage users.</p>
        </section>
      </SettingsShell>
    );
  }

  return (
    <SettingsShell>
      <UsersContent />
    </SettingsShell>
  );
}

function UsersContent() {
  const { data: session } = useSession();
  const myId = session?.user?.id;
  const { selectedOrgId, loading: orgLoading } = useOrg();
  const [users, setUsers] = useState<OrgMember[] | null>(null);
  const [filter, setFilter] = useState<MemberStatus | ''>('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setUsers((await membersApi.list()).users);
    } catch (err) {
      setUsers(null);
      setError(errorMessage(err, 'Could not load users'));
    }
  }, []);

  // Wait for the org switcher, refetch on org change (same gate as other Settings pages).
  const loadedForOrg = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (orgLoading && !selectedOrgId) return;
    if (loadedForOrg.current === selectedOrgId) return;
    loadedForOrg.current = selectedOrgId;
    load();
  }, [orgLoading, selectedOrgId, load]);

  useEffect(() => {
    try {
      const flash = sessionStorage.getItem(FLASH_KEY);
      if (flash) {
        sessionStorage.removeItem(FLASH_KEY);
        setNotice(flash);
      }
    } catch {
      // Storage blocked: no flash message
    }
  }, []);

  const run = async (member: OrgMember, action: () => Promise<unknown>, done: string) => {
    setBusyId(member.id);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(done);
      await load();
    } catch (err) {
      setError(errorMessage(err, 'Could not update this user'));
    } finally {
      setBusyId(null);
    }
  };

  const label = (m: OrgMember) => m.name || m.email;
  const visible = (users ?? []).filter((u) => !filter || u.status === filter);
  const counts = (status: MemberStatus | '') => (users ?? []).filter((u) => !status || u.status === status).length;

  return (
    <section aria-labelledby="users-heading" className="min-w-0 flex-1">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="users-heading" className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
            <UsersIcon className="h-5 w-5 text-gray-500 dark:text-slate-400" />
            Users
          </h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
            People who can sign in to this organization&apos;s admin.
          </p>
        </div>
        <Link href="/admin/settings/users/new" className={primaryBtn}>
          Add users
        </Link>
      </div>

      {notice && (
        <p role="status" className="mb-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300">
          {notice}
        </p>
      )}
      {error && (
        <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <div role="group" aria-label="Filter users by status" className="flex gap-1 border-b border-gray-200 p-2 dark:border-slate-700">
          {FILTERS.map((f) => (
            <button
              key={f.value || 'all'}
              type="button"
              aria-pressed={filter === f.value}
              onClick={() => setFilter(f.value)}
              className={`min-h-[44px] rounded-md px-3 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 sm:min-h-0 sm:py-1.5 ${
                filter === f.value
                  ? 'bg-gray-100 text-gray-900 dark:bg-slate-700 dark:text-white'
                  : 'text-gray-600 hover:bg-gray-50 dark:text-slate-400 dark:hover:bg-slate-700/50'
              }`}
            >
              {f.label}
              {users && <span className="ml-1.5 text-xs text-gray-500 dark:text-slate-400">{counts(f.value)}</span>}
            </button>
          ))}
        </div>

        {!users ? (
          <p className="px-4 py-8 text-center text-sm text-gray-600 dark:text-slate-400" aria-busy={!error}>
            {error ? 'Users could not be loaded.' : 'Loading users…'}
          </p>
        ) : visible.length === 0 ? (
          <p role="status" className="px-4 py-8 text-center text-sm text-gray-600 dark:text-slate-400">
            {filter === 'PENDING' ? 'No pending invitations.' : 'No users match this filter.'}
          </p>
        ) : (
          <>
            {/* Column labels for the sm+ grid; each row labels its own controls */}
            <div aria-hidden="true" className={`hidden bg-gray-50 dark:bg-slate-900 xl:grid ${grid}`}>
              <span className={th}>User</span>
              <span className={th}>Status</span>
              <span className={th}>Role</span>
              <span />
            </div>
            <ul role="list" className="divide-y divide-gray-100 border-t border-gray-200 dark:divide-slate-700 dark:border-slate-700">
              {visible.map((m) => {
                const isMe = m.id === myId;
                const busy = busyId === m.id;
                return (
                  <li key={m.id} data-testid={`member-${m.email}`} className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 xl:grid xl:gap-4 ${grid}`}>
                    <div className="min-w-0 basis-full xl:basis-auto">
                      <div className="truncate text-sm font-medium text-gray-900 dark:text-white" title={m.email}>
                        {label(m)}
                        {isMe && <span className="ml-1.5 text-xs font-normal text-gray-600 dark:text-slate-400">(you)</span>}
                      </div>
                      {m.name && <div className="truncate text-xs text-gray-600 dark:text-slate-400">{m.email}</div>}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <MemberStatusPill status={m.status} />
                      <TwoStepBadge member={m} />
                    </div>
                    <div>
                      <label className="sr-only" htmlFor={`role-${m.id}`}>
                        Role for {label(m)}
                      </label>
                      <select
                        id={`role-${m.id}`}
                        value={m.role}
                        disabled={busy || isMe}
                        onChange={(e) => {
                          const role = e.target.value as MemberRole;
                          run(m, () => membersApi.update(m.id, { role }), `${label(m)} is now ${role === 'ADMIN' ? 'an Admin' : 'an Organizer'}.`);
                        }}
                        className="min-h-[44px] rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 sm:min-h-0 sm:py-1"
                      >
                        {(Object.keys(ROLE_LABEL) as MemberRole[]).map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABEL[r]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="ml-auto flex flex-wrap gap-2 xl:ml-0 xl:flex-nowrap xl:justify-end">
                      {!isMe && m.status === 'PENDING' && (
                        <button
                          type="button"
                          className={linkBtn}
                          disabled={busy}
                          aria-label={`Resend invite to ${label(m)}`}
                          onClick={() => run(m, () => membersApi.resend(m.id), `Invite re-sent to ${m.email}.`)}
                        >
                          Resend invite
                        </button>
                      )}
                      {!isMe && (
                        <button
                          type="button"
                          className={dangerBtn}
                          disabled={busy}
                          aria-label={`Remove ${label(m)} from this organization`}
                          onClick={() => {
                            if (!window.confirm(`Remove ${label(m)} from this organization? They will lose access to its admin.`)) return;
                            run(m, () => membersApi.remove(m.id), `${label(m)} was removed.`);
                          }}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}

/** Shield next to the status: two-step on, or required but not set up yet. */
function TwoStepBadge({ member }: { member: OrgMember }) {
  if (member.twoStepEnabled) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-gray-600 dark:text-slate-400" title="Two-step authentication is on">
        <ShieldIcon className="h-4 w-4 text-green-700 dark:text-green-400" />
        <span className="sr-only">Two-step authentication is on</span>
      </span>
    );
  }
  if (member.requireTwoStep) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-amber-800 dark:text-amber-300">
        <ShieldIcon className="h-4 w-4" />
        Two-step required
      </span>
    );
  }
  return null;
}
