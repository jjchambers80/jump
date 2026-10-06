'use client';

import { useState, useCallback } from 'react';
import { useAccountFormat } from '@/lib/accountFormat';
import { agentAccessApi, type AgentGrant, type AgentAuditLogEntry } from '@/services/api';
import SettingsNav from '../SettingsNav';
import SummaryRow from '../SummaryRow';
import { ExternalLinkIcon, XIcon, FilterIcon, DownloadIcon, Trash2Icon, AlertTriangleIcon } from 'lucide-react';

const cardClass = 'rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-5';
const dangerBtn = 'rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:border-red-800 dark:bg-slate-800 dark:text-red-300';
const switchBase = 'relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-800';
const switchOn = 'bg-indigo-600';
const switchOff = 'bg-gray-200 dark:bg-slate-700';
const thumb = 'block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform';

export default function AgentAccessSettingsPage() {
  const { formatDateTime } = useAccountFormat();
  const [settings, setSettings] = useState<{ agentAccessEnabled: boolean } | null>(null);
  const [grants, setGrants] = useState<AgentGrant[]>([]);
  const [auditLog, setAuditLog] = useState<AgentAuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [auditOffset, setAuditOffset] = useState(0);
  const [auditLimit] = useState(50);
  const [hasMoreAudit, setHasMoreAudit] = useState(true);
  const [auditFilterGrant, setAuditFilterGrant] = useState<string>('');
  const [auditFilterTool, setAuditFilterTool] = useState<string>('');

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, g, a] = await Promise.all([
        agentAccessApi.getSettings(),
        agentAccessApi.listGrants(),
        agentAccessApi.listAuditLog({ offset: 0, limit: auditLimit }),
      ]);
      setSettings(s);
      setGrants(g.grants);
      setAuditLog(a.rows);
      setHasMoreAudit(a.total > a.rows.length);
    } catch (e: any) {
      setError(e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [auditLimit]);

  const loadMoreAudit = useCallback(async () => {
    try {
      const a = await agentAccessApi.listAuditLog({
        offset: auditOffset,
        limit: auditLimit,
        grantId: auditFilterGrant || undefined,
        tool: auditFilterTool || undefined,
      });
      setAuditLog((prev) => [...prev, ...a.rows]);
      setHasMoreAudit(a.total > auditOffset + a.rows.length);
    } catch (e: any) {
      setError(e.message || 'Failed to load more');
    }
  }, [auditOffset, auditLimit, auditFilterGrant, auditFilterTool]);

  const handleToggle = useCallback(async () => {
    if (!settings) return;
    try {
      await agentAccessApi.toggleSettings(!settings.agentAccessEnabled);
      setSettings({ agentAccessEnabled: !settings.agentAccessEnabled });
    } catch (e: any) {
      setError(e.message || 'Failed to toggle');
    }
  }, [settings]);

  const handleRevoke = useCallback(async (id: string) => {
    if (!window.confirm('Revoke this grant? The agent will immediately lose access to this store.')) return;
    try {
      await agentAccessApi.revokeGrant(id);
      await loadAll();
    } catch (e: any) {
      setError(e.message || 'Failed to revoke');
    }
  }, [loadAll]);

  const handleRevokeAll = useCallback(async () => {
    if (!window.confirm('Revoke ALL grants for this store? All connected agents will lose access immediately. This cannot be undone.')) return;
    try {
      await agentAccessApi.revokeAllGrants();
      await loadAll();
    } catch (e: any) {
      setError(e.message || 'Failed to revoke all');
    }
  }, [loadAll]);

  const handleAuditFilterChange = useCallback(async () => {
    setAuditOffset(0);
    try {
      const a = await agentAccessApi.listAuditLog({
        offset: 0,
        limit: auditLimit,
        grantId: auditFilterGrant || undefined,
        tool: auditFilterTool || undefined,
      });
      setAuditLog(a.rows);
      setHasMoreAudit(a.total > a.rows.length);
    } catch (e: any) {
      setError(e.message || 'Failed to filter');
    }
  }, [auditLimit, auditFilterGrant, auditFilterTool]);

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-200 rounded w-1/4 dark:bg-slate-700" />
          <div className="h-64 bg-gray-200 rounded dark:bg-slate-700" />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Settings</h1>
      <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
        Manage your organization and business information.
      </p>

      <div className="mt-8 flex min-w-0 flex-col gap-6 md:flex-row md:items-start">
        <SettingsNav />

        <section aria-labelledby="agent-access-heading" className="min-w-0 flex-1 space-y-6">
          <div>
            <h2 id="agent-access-heading" className="text-lg font-semibold text-gray-900 dark:text-white">
              Agent access
            </h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
              Control which AI agents can connect to your store. Only ADMIN members can create grants.
            </p>
          </div>

          {/* Store switch */}
          <div className={cardClass}>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Store agent access</h3>
                <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
                  When enabled, ADMIN members can connect AI agents (ChatGPT, Claude, coding agents) to this store
                  via OAuth. Agents can read store data and, with additional scopes, create drafts and manage content.
                </p>
              </div>
              <button
                onClick={handleToggle}
                className={`${switchBase} ${settings?.agentAccessEnabled ? switchOn : switchOff}`}
                role="switch"
                aria-checked={settings?.agentAccessEnabled}
                aria-label="Toggle agent access"
              >
                <span className={`${thumb} ${settings?.agentAccessEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </div>
          </div>

          {/* Grants list */}
          <div className={cardClass}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Active grants</h3>
              {grants.some((g) => !g.revokedAt) && (
                <button
                  onClick={handleRevokeAll}
                  className={dangerBtn}
                >
                  <Trash2Icon className="h-4 w-4 mr-1" />
                  Revoke all
                </button>
              )}
            </div>

            {grants.length === 0 ? (
              <p className="text-sm text-gray-600 dark:text-slate-400 py-8 text-center">
                No agent grants yet. ADMIN members can connect agents from the agent's interface.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-600 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
                      <th className="pb-2 font-medium">Member</th>
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
                          <div className="font-medium text-gray-900 dark:text-white">
                            {grant.member?.name ?? 'Unknown'}
                          </div>
                          <div className="text-gray-600 dark:text-slate-400">{grant.member?.email}</div>
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
                              Revoked {grant.revokedReason ? `(${grant.revokedReason})` : ''}
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
            )}
          </div>

          {/* Audit log */}
          <div className={cardClass}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Audit log</h3>
              <div className="flex items-center gap-2">
                <select
                  value={auditFilterGrant}
                  onChange={(e) => { setAuditFilterGrant(e.target.value); handleAuditFilterChange(); }}
                  className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800"
                  aria-label="Filter by grant"
                >
                  <option value="">All grants</option>
                  {grants.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.member?.name ?? g.userId} — {g.client.name}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={auditFilterTool}
                  onChange={(e) => { setAuditFilterTool(e.target.value); handleAuditFilterChange(); }}
                  placeholder="Filter by tool…"
                  className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 w-48"
                  aria-label="Filter by tool"
                />
              </div>
            </div>

            {auditLog.length === 0 ? (
              <p className="text-sm text-gray-600 dark:text-slate-400 py-8 text-center">No audit entries</p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-gray-600 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
                        <th className="pb-2 font-medium">Time</th>
                        <th className="pb-2 font-medium">User</th>
                        <th className="pb-2 font-medium">Grant</th>
                        <th className="pb-2 font-medium">Tool</th>
                        <th className="pb-2 font-medium">Summary</th>
                        <th className="pb-2 font-medium">Outcome</th>
                        <th className="pb-2 font-medium">Target</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                      {auditLog.map((entry) => (
                        <tr key={entry.id}>
                          <td className="py-2 text-gray-600 dark:text-slate-400 whitespace-nowrap">
                            {formatDateTime(entry.createdAt)}
                          </td>
                          <td className="py-2">
                            <div className="font-medium text-gray-900 dark:text-white">
                              {entry.user.name}
                            </div>
                            <div className="text-xs text-gray-500 dark:text-slate-500">{entry.user.email}</div>
                          </td>
                          <td className="py-2 text-gray-600 dark:text-slate-400">{entry.clientName}</td>
                          <td className="py-2 text-gray-900 dark:text-white font-mono text-xs">{entry.tool}</td>
                          <td className="py-2 text-gray-600 dark:text-slate-400 max-w-xs truncate">{entry.summary}</td>
                          <td className="py-2">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                                entry.outcome === 'ok'
                                  ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                                  : entry.outcome === 'denied'
                                  ? 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                                  : entry.outcome === 'error'
                                  ? 'bg-yellow-50 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300'
                                  : 'bg-gray-50 text-gray-700 dark:bg-slate-700 dark:text-gray-300'
                              }`}
                            >
                              {entry.outcome}
                            </span>
                          </td>
                          <td className="py-2 text-gray-600 dark:text-slate-400 text-xs">
                            {entry.targetType && entry.targetId
                              ? `${entry.targetType}:${entry.targetId.slice(0, 8)}…`
                              : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {hasMoreAudit && (
                  <div className="mt-4 text-center">
                    <button
                      onClick={loadMoreAudit}
                      disabled={loading}
                      className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
                    >
                      Load more
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}