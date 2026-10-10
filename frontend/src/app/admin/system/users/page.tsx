'use client';

// System administration › Users: every account on the platform
// (GET /admin/system/users). Filters live in the URL (q, role, status, page)
// so a view can be shared. Invite and the per-row actions need a step-up
// proof (withReauth). Your own row and the last active system admin are
// locked with a visible reason; the backend enforces both too
// (CANNOT_CHANGE_SELF, LAST_SYSTEM_ADMIN).

import { FormEvent, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { UserPlus } from 'lucide-react';
import ActionsMenu, { type ActionsMenuItem } from '@/components/ActionsMenu';
import { ReauthProvider } from '@/app/admin/account/useReauth';
import { MemberStatusPill, errorMessage, primaryBtn, secondaryBtn } from '@/app/admin/settings/users/shared';
import { useAccountFormat } from '@/lib/accountFormat';
import { systemAdminApi, type SystemUser, type SystemUserListParams } from '@/services/api';
import { InviteDialog, UserActionDialog, userLabel, type UserAction } from './UserDialogs';

const ROLE_LABEL: Record<SystemUser['role'], string> = {
  SYSTEM_ADMIN: 'System admin',
  ADMIN: 'Admin',
  ORGANIZER: 'Organizer',
  UNASSIGNED: 'No role',
};

/** Preset filters: each sets role/status in the URL and clears the other. */
const FILTERS: { label: string; role?: SystemUser['role']; status?: 'ACTIVE' | 'INACTIVE' }[] = [
  { label: 'All' },
  { label: 'System admins', role: 'SYSTEM_ADMIN' },
  { label: 'Admins', role: 'ADMIN' },
  { label: 'Organizers', role: 'ORGANIZER' },
  { label: 'Inactive', status: 'INACTIVE' },
];

const ROLES = Object.keys(ROLE_LABEL) as SystemUser['role'][];

const grid = 'lg:grid-cols-[minmax(0,2fr)_9rem_7rem_minmax(0,2fr)_8rem_3rem]';
const th = 'py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-slate-400';

function UsersContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const myId = session?.user?.id;
  const { formatDateTime } = useAccountFormat();

  const q = searchParams.get('q') ?? '';
  const roleParam = searchParams.get('role');
  const role = ROLES.includes(roleParam as SystemUser['role']) ? (roleParam as SystemUser['role']) : undefined;
  const statusParam = searchParams.get('status');
  const status = statusParam === 'ACTIVE' || statusParam === 'INACTIVE' ? statusParam : undefined;
  const page = Math.max(1, Number(searchParams.get('page')) || 1);

  const [searchInput, setSearchInput] = useState(q);
  const [data, setData] = useState<{ users: SystemUser[]; total: number; totalPages: number } | null>(null);
  const [lastAdminId, setLastAdminId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [pending, setPending] = useState<{ action: UserAction; user: SystemUser } | null>(null);
  const inviteBtnRef = useRef<HTMLButtonElement>(null);
  const actionReturnRef = useRef<HTMLElement | null>(null);

  useEffect(() => setSearchInput(q), [q]);

  const setQuery = (next: SystemUserListParams) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(next)) if (value) params.set(key, String(value));
    if (params.get('page') === '1') params.delete('page');
    router.replace(`${pathname}${params.size ? `?${params}` : ''}`, { scroll: false });
  };

  const load = useCallback(async () => {
    setError(null);
    try {
      const [list, admins] = await Promise.all([
        systemAdminApi.users({ q, role, status, page }),
        systemAdminApi.users({ role: 'SYSTEM_ADMIN', status: 'ACTIVE' }),
      ]);
      setData({ users: list.users, total: list.pagination.total, totalPages: list.pagination.totalPages });
      setLastAdminId(admins.pagination.total === 1 ? admins.users[0]?.id ?? null : null);
    } catch (err) {
      setData(null);
      setError(errorMessage(err, 'Could not load users.'));
    }
  }, [q, role, status, page]);

  useEffect(() => {
    load();
  }, [load]);

  const finish = (message: string) => {
    setInviting(false);
    setPending(null);
    setNotice(message);
    load();
  };

  const search = (event: FormEvent) => {
    event.preventDefault();
    setQuery({ q: searchInput.trim(), role, status });
  };

  const rowLock = (u: SystemUser) => {
    if (u.id === myId) return "You can't change your own access.";
    if (u.id === lastAdminId) return 'Last active system admin: invite another before removing or deactivating.';
    return null;
  };

  const itemsFor = (u: SystemUser): ActionsMenuItem[] => {
    const self = u.id === myId;
    const last = u.id === lastAdminId;
    const open = (action: UserAction) => (trigger: HTMLButtonElement) => {
      actionReturnRef.current = trigger;
      setNotice(null);
      setPending({ action, user: u });
    };
    const items: ActionsMenuItem[] = [
      u.role === 'SYSTEM_ADMIN'
        ? { label: 'Remove system admin', onSelect: open('demote'), disabled: self || last }
        : { label: 'Make system admin', onSelect: open('promote'), disabled: self },
    ];
    items.push(
      u.isActive
        ? { label: 'Deactivate', onSelect: open('deactivate'), disabled: self || last, danger: true }
        : { label: 'Reactivate', onSelect: open('reactivate'), disabled: self }
    );
    return items;
  };

  const filterActive = (f: (typeof FILTERS)[number]) => f.role === role && f.status === status;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Users</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">Every account on the platform, across all organizations.</p>
        </div>
        <button ref={inviteBtnRef} type="button" className={`${primaryBtn} gap-2`} onClick={() => setInviting(true)}>
          <UserPlus className="h-4 w-4" aria-hidden="true" />
          Invite system admin
        </button>
      </div>

      <div aria-live="polite" role="status">
        {notice && (
          <p className="mb-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300">
            {notice}
          </p>
        )}
      </div>
      {error && (
        <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
          <span>{error}</span>
          <button type="button" className={secondaryBtn} onClick={() => load()}>
            Try again
          </button>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <div className="flex flex-col gap-3 border-b border-gray-200 p-3 dark:border-slate-700 lg:flex-row lg:items-center lg:justify-between">
          <div role="group" aria-label="Filter users" className="flex flex-wrap gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.label}
                type="button"
                aria-pressed={filterActive(f)}
                onClick={() => setQuery({ q, role: f.role, status: f.status })}
                className={`min-h-[44px] rounded-md px-3 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 sm:min-h-0 sm:py-1.5 ${
                  filterActive(f)
                    ? 'bg-gray-100 text-gray-900 dark:bg-slate-700 dark:text-white'
                    : 'text-gray-600 hover:bg-gray-50 dark:text-slate-400 dark:hover:bg-slate-700/50'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <form role="search" onSubmit={search} className="flex gap-2">
            <label htmlFor="system-users-search" className="sr-only">
              Search users by name or email
            </label>
            <input
              id="system-users-search"
              type="search"
              value={searchInput}
              maxLength={100}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Name or email"
              className="min-h-[44px] w-full min-w-0 rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 sm:min-h-0 sm:py-1.5 lg:w-64"
            />
            <button type="submit" className={secondaryBtn}>
              Search
            </button>
          </form>
        </div>

        {!data ? (
          <p className="px-4 py-8 text-center text-sm text-gray-600 dark:text-slate-400" aria-busy={!error}>
            {error ? 'Users could not be loaded.' : 'Loading users…'}
          </p>
        ) : data.users.length === 0 ? (
          <p role="status" className="px-4 py-8 text-center text-sm text-gray-600 dark:text-slate-400">
            {q ? `No users match “${q}”.` : 'No users match this filter.'}
          </p>
        ) : (
          <>
            <div aria-hidden="true" className={`hidden gap-4 bg-gray-50 px-4 dark:bg-slate-900 lg:grid ${grid}`}>
              <span className={th}>User</span>
              <span className={th}>Role</span>
              <span className={th}>Status</span>
              <span className={th}>Organizations</span>
              <span className={th}>Joined</span>
              <span />
            </div>
            <ul role="list" className="divide-y divide-gray-100 border-t border-gray-200 dark:divide-slate-700 dark:border-slate-700 lg:border-t-0">
              {data.users.map((u) => {
                const lock = rowLock(u);
                return (
                  <li
                    key={u.id}
                    data-testid={`system-user-${u.email}`}
                    className={`grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 px-4 py-3 lg:items-center lg:gap-4 ${grid}`}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-gray-900 dark:text-white" title={u.email}>
                        {userLabel(u)}
                        {u.id === myId && <span className="ml-1.5 text-xs font-normal text-gray-600 dark:text-slate-400">(you)</span>}
                      </div>
                      {u.name && <div className="truncate text-xs text-gray-600 dark:text-slate-400">{u.email}</div>}
                      {lock && <p className="mt-1 text-xs text-gray-600 dark:text-slate-400">{lock}</p>}
                    </div>
                    {/* Mobile: actions sit beside the name; desktop: last column */}
                    <div className="col-start-2 row-start-1 flex justify-end lg:col-start-6">
                      <ActionsMenu label={`Actions for ${userLabel(u)}`} items={itemsFor(u)} />
                    </div>
                    <div className="col-span-2 flex flex-wrap items-center gap-2 text-sm text-gray-700 dark:text-slate-300 lg:col-span-1 lg:col-start-2 lg:row-start-1">
                      <span className="lg:hidden text-gray-500 dark:text-slate-400">Role:</span>
                      {ROLE_LABEL[u.role]}
                    </div>
                    <div className="col-span-2 lg:col-span-1 lg:col-start-3 lg:row-start-1">
                      <MemberStatusPill status={u.isActive ? 'ACTIVE' : 'INACTIVE'} />
                    </div>
                    <div className="col-span-2 min-w-0 text-sm text-gray-700 dark:text-slate-300 lg:col-span-1 lg:col-start-4 lg:row-start-1">
                      <span className="lg:hidden text-gray-500 dark:text-slate-400">Organizations: </span>
                      {u.organizations.length ? u.organizations.map((o) => o.name).join(', ') : <span className="text-gray-500 dark:text-slate-400">None</span>}
                    </div>
                    <div className="col-span-2 text-sm text-gray-600 dark:text-slate-400 lg:col-span-1 lg:col-start-5 lg:row-start-1">
                      <span className="lg:hidden">Joined </span>
                      {formatDateTime(u.createdAt, { dateStyle: 'medium' })}
                    </div>
                  </li>
                );
              })}
            </ul>
            <nav aria-label="Pagination" className="flex items-center justify-between gap-3 border-t border-gray-200 px-4 py-3 text-sm text-gray-600 dark:border-slate-700 dark:text-slate-400">
              <span>
                {data.total.toLocaleString('en-US')} {data.total === 1 ? 'user' : 'users'} · page {page} of {Math.max(1, data.totalPages)}
              </span>
              <div className="flex gap-2">
                <button type="button" className={secondaryBtn} disabled={page <= 1} onClick={() => setQuery({ q, role, status, page: page - 1 })}>
                  Previous
                </button>
                <button type="button" className={secondaryBtn} disabled={page >= data.totalPages} onClick={() => setQuery({ q, role, status, page: page + 1 })}>
                  Next
                </button>
              </div>
            </nav>
          </>
        )}
      </div>

      {inviting && <InviteDialog returnFocusRef={inviteBtnRef} onClose={() => setInviting(false)} onDone={finish} />}
      {pending && (
        <UserActionDialog
          action={pending.action}
          user={pending.user}
          returnFocusRef={actionReturnRef}
          onClose={() => setPending(null)}
          onDone={finish}
        />
      )}
    </div>
  );
}

export default function SystemUsersPage() {
  return (
    <ReauthProvider>
      <Suspense fallback={<p className="px-4 py-8 text-sm text-gray-600 dark:text-slate-400">Loading users…</p>}>
        <UsersContent />
      </Suspense>
    </ReauthProvider>
  );
}
