'use client';

import { useState, useCallback } from 'react';
import { useAccountFormat } from '@/lib/accountFormat';
import { agentAccessApi, type AgentGrant } from '@/services/api';
import AccountNav from '../AccountNav';

const cardClass = 'rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-5';
const dangerBtn = 'rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:border-red-800 dark:bg-slate-800 dark:text-red-300';
import { Trash2Icon, AlertTriangleIcon } from 'lucide-react';

export default function ConnectedAppsPage() {
  const { formatDateTime } = useAccountFormat();
  const [grants, setGrants] = useState<AgentGrant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadGrants = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const g = await agentAccessApi.listMyGrants();
      setGrants(g.grants);
    } catch (e: any) {
      setError(e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleRevoke = useCallback(async (id: string) => {
    if (!window.confirm('Revoke this grant? The agent will immediately lose access to the organization store.')) return;
    try {
      await agentAccessApi.revokeMyGrant(id);
      await loadGrants();
    } catch (e: any) {
      setError(e.message || 'Failed to revoke');
    }
  }, [loadGrants]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Account</h1>
      <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
        Your personal profile and preferences. These settings belong to you, not to an organization.
      </p>

      <div className="mt-8 flex min-w-0 flex-col gap-6 md:flex-row md:items-start">
        <AccountNav />

        <section aria-labelledby="connected-apps-heading" className="min-w-0 flex-1 space-y-6">
          <div>
            <h2 id="connected-apps-heading" className="text-lg font-semibold text-gray-900 dark:text-white">
              Connected apps
            </h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
              AI agents (ChatGPT, Claude, coding agents) you have authorized to access your stores. Revoking a grant
              immediately blocks that agent's access.
            </p>
          </div>

          {loading ? (
            <div className={cardClass}>
              <div className="animate-pulse space-y-4">
                <div className="h-12 bg-gray-200 rounded dark:bg-slate-700" />
                <div className="h-12 bg-gray-200 rounded dark:bg-slate-700" />
              </div>
            </div>
          ) : error ? (
            <div className={cardClass}>
              <p className="text-red-600 dark:text-red-400">{error}</p>
            </div>
          ) : grants.length === 0 ? (
            <div className={cardClass}>
              <p className="text-sm text-gray-600 dark:text-slate-400 py-8 text-center">
                No connected apps. You can connect AI agents from their respective interfaces when an organization
                has agent access enabled and you are an ADMIN member.
              </p>
            </div>
          ) : (
            <div className={cardClass}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-600 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
                      <th className="pb-2 font-medium">Organization</th>
                      <th className="pb-2 font-medium">Client</th>
                      <th className="pb-2 font-medium">Scopes</th>
                      <th className="pb-2 font-medium">Created</th>
                      <th className="pb-2 font-medium">Last used</th>
                      <th className="pb-2 font-medium">Status</th>
                      <th className="pb-2 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                    {grants.map((grant) => (
                      <tr key={grant.id}>
                        <td className="py-3">
                          <div className="font-medium text-gray-900 dark:text-white">{grant.organizationName}</div>
                        </td>
                        <td className="py-3">
                          <div className="font-medium text-gray-900 dark:text-white">{grant.client.name}</div>
                          <div className="text-xs text-gray-500 dark:text-slate-500">
                            {grant.client.kind} • {grant.client.clientId}
                          </div>
                        </td>
                        <td className="py-3">
                          <div className="flex flex-wrap gap-1">
                            {grant.scopes.map((s) => (
                              <span
                                key={s}
                                className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300"
                              >
                                {s}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="py-3 text-gray-600 dark:text-slate-400">
                          {formatDateTime(grant.createdAt)}
                        </td>
                        <td className="py-3 text-gray-600 dark:text-slate-400">
                          {grant.lastUsedAt ? formatDateTime(grant.lastUsedAt) : '—'}
                        </td>
                        <td className="py-3">
                          {grant.revokedAt ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300">
                              Revoked
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300">
                              Active
                            </span>
                          )}
                        </td>
                        <td className="py-3 text-right">
                          {!grant.revokedAt && (
                            <button
                              onClick={() => handleRevoke(grant.id)}
                              className="text-sm text-red-600 hover:text-red-700 dark:text-red-400 font-medium"
                            >
                              Revoke
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}