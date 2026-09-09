// User Management page — admin area (T014, T019)
// Moved from dashboard/users/page.tsx
// AdminRoute wrapper removed — layout.tsx handles auth guard
// ADMIN-only access enforced by role check within page (T019)

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import api from '@/services/api';

interface UserSummary {
  id: string;
  email: string;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  role: string;
  organizationId: string | null;
  organizationName: string | null;
  isActive: boolean;
  createdAt: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export default function UsersPage() {
  const { data: session, status } = useSession();
  const userRole = (session?.user as any)?.role;

  // T019: ADMIN/SYSTEM_ADMIN-only guard — ORGANIZER sees access denied
  if (status === 'authenticated' && !['ADMIN', 'SYSTEM_ADMIN'].includes(userRole)) {
    return (
      <div className="max-w-md mx-auto py-16 px-4 text-center">
        <div className="text-6xl mb-4">🔒</div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Access Denied</h1>
        <p className="text-gray-600 dark:text-slate-400">Admin role required to manage users.</p>
      </div>
    );
  }

  return <UsersContent />;
}

function UsersContent() {
  const { data: session } = useSession();
  const userRole = (session?.user as any)?.role;
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [roleFilter, setRoleFilter] = useState('');
  const [page, setPage] = useState(1);
  const [updating, setUpdating] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', '20');
      if (roleFilter) params.set('role', roleFilter);

      const data = await api.get<{ users: UserSummary[]; pagination: Pagination }>(
        `/users?${params.toString()}`
      );
      setUsers(data.users);
      setPagination(data.pagination);
    } catch (err: any) {
      setError(err.message || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, [page, roleFilter]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  async function handleRoleChange(userId: string, newRole: string) {
    setUpdating(userId);
    try {
      const updated = await api.patch<UserSummary>(`/users/${userId}`, { role: newRole });
      setUsers((prev) => prev.map((u) => (u.id === userId ? updated : u)));
    } catch (err: any) {
      setError(err.message || 'Failed to update role');
    } finally {
      setUpdating(null);
    }
  }

  async function handleToggleActive(userId: string, currentActive: boolean) {
    setUpdating(userId);
    try {
      const updated = await api.patch<UserSummary>(`/users/${userId}`, {
        isActive: !currentActive,
      });
      setUsers((prev) => prev.map((u) => (u.id === userId ? updated : u)));
    } catch (err: any) {
      setError(err.message || 'Failed to update status');
    } finally {
      setUpdating(null);
    }
  }

  const roles = userRole === 'SYSTEM_ADMIN'
    ? ['CUSTOMER', 'ORGANIZER', 'ADMIN', 'SYSTEM_ADMIN']
    : ['CUSTOMER', 'ORGANIZER', 'ADMIN'];

  return (
    <div className="max-w-6xl mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">User Management</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
            {pagination ? `${pagination.total} users total` : 'Loading...'}
          </p>
        </div>

        {/* Role Filter */}
        <select
          value={roleFilter}
          onChange={(e) => {
            setRoleFilter(e.target.value);
            setPage(1);
          }}
          className="px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-sm text-gray-700 dark:text-slate-300"
        >
          <option value="">All roles</option>
          {roles.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
        </div>
      ) : (
        <>
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
              <thead className="bg-gray-50 dark:bg-slate-900">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase">
                    User
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase">
                    Role
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase">
                    Organization
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase">
                    Joined
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                {users.map((user) => (
                  <tr key={user.id} className={!user.isActive ? 'opacity-50' : ''}>
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-gray-900 dark:text-white">
                        {user.name ||
                          [user.firstName, user.lastName].filter(Boolean).join(' ') ||
                          '—'}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-slate-400">{user.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={user.role}
                        onChange={(e) => handleRoleChange(user.id, e.target.value)}
                        disabled={updating === user.id || user.id === session?.user?.id}
                        className="text-xs px-2 py-1 border border-gray-300 dark:border-slate-600 rounded bg-white dark:bg-slate-700 text-gray-700 dark:text-slate-300 disabled:opacity-50"
                      >
                        {roles.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-slate-400">
                      {user.organizationName || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleToggleActive(user.id, user.isActive)}
                        disabled={updating === user.id || user.id === session?.user?.id}
                        className={`text-xs font-medium px-2.5 py-1 rounded-full transition disabled:opacity-50 ${
                          user.isActive
                            ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 hover:bg-green-200'
                            : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 hover:bg-red-200'
                        }`}
                      >
                        {user.isActive ? 'Active' : 'Inactive'}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 dark:text-slate-400">
                      {new Date(user.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {pagination && pagination.totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="text-sm px-3 py-1.5 border border-gray-300 dark:border-slate-600 rounded-lg disabled:opacity-50 text-gray-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-800"
              >
                Previous
              </button>
              <span className="text-sm text-gray-500 dark:text-slate-400">
                Page {pagination.page} of {pagination.totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                disabled={page >= pagination.totalPages}
                className="text-sm px-3 py-1.5 border border-gray-300 dark:border-slate-600 rounded-lg disabled:opacity-50 text-gray-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-800"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
