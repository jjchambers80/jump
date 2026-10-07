'use client';

import { useState, useCallback, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useAccountFormat } from '@/lib/accountFormat';
import { ReauthProvider, isReauthCancelled, useReauth } from '@/app/admin/account/useReauth';
import { agentAccessApi, type AgentPlatformStats } from '@/services/api';
import { AlertTriangleIcon, Trash2Icon, ShieldAlertIcon, BarChart2Icon, UsersIcon, ZapIcon } from 'lucide-react';

const cardClass = 'rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-5';
const dangerBtn = 'rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:border-red-800 dark:bg-slate-800 dark:text-red-300';
const switchBase = 'relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-800';
const switchOn = 'bg-indigo-600';
const switchOff = 'bg-gray-200 dark:bg-slate-700';
const thumb = 'block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform';

function PlatformSettingsPage() {
  const { withReauth } = useReauth();
  const { data: session, status } = useSession();
  const router = useRouter();
  const { formatDateTime } = useAccountFormat();
  const [settings, setSettings] = useState<{ agentAccessEnabled: boolean } | null>(null);
  const [stats, setStats] = useState<AgentPlatformStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, st] = await Promise.all([
        agentAccessApi.getPlatformSettings(),
        agentAccessApi.getPlatformStats(),
      ]);
      setSettings(s);
      setStats(st);
    } catch (e: any) {
      setError(e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleToggle = useCallback(async () => {
    if (!settings) return;
    if (!window.confirm(settings?.agentAccessEnabled 
      ? 'Disable global agent access? This will immediately block ALL agent calls across the platform.' 
      : 'Enable global agent access? Organizations with their own switches on can connect AI agents.')) return;
    try {
      await withReauth(() => agentAccessApi.setPlatformSettings(!settings.agentAccessEnabled));
      setSettings({ agentAccessEnabled: !settings.agentAccessEnabled });
    } catch (e: any) {
      if (isReauthCancelled(e)) return;
      setError(e.message || 'Failed to toggle');
    }
  }, [settings, withReauth]);

  const handleRevokeAll = useCallback(async () => {
    const confirmation = prompt('Type "REVOKE ALL GRANTS" to confirm:');
    if (confirmation !== 'REVOKE ALL GRANTS') return;
    try {
      await withReauth(() => agentAccessApi.revokeAllPlatformGrants(confirmation));
      await loadAll();
    } catch (e: any) {
      if (isReauthCancelled(e)) return;
      setError(e.message || 'Failed to revoke all');
    }
  }, [loadAll, withReauth]);

  // Check SYSTEM_ADMIN access
  const isSystemAdmin = (session?.user as { role?: string } | undefined)?.role === 'SYSTEM_ADMIN';

  if (status === 'loading') {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-200 rounded w-1/4 dark:bg-slate-700" />
          <div className="h-64 bg-gray-200 rounded dark:bg-slate-700" />
        </div>
      </div>
    );
  }

  if (!isSystemAdmin) {
    if (status === 'unauthenticated') {
      router.push('/auth/signin?callbackUrl=/admin/settings/platform');
    }
    return (
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <div className={cardClass} style={{ minHeight: '300px' }}>
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <ShieldAlertIcon className="h-12 w-12 mx-auto text-gray-400 dark:text-slate-500" />
              <h3 className="mt-4 text-lg font-semibold text-gray-900 dark:text-white">Access denied</h3>
              <p className="mt-2 text-sm text-gray-600 dark:text-slate-400">
                This page is only accessible to SYSTEM_ADMIN users.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Settings</h1>
      <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
        Platform-wide settings. Changes here affect all organizations on Jump.
      </p>

      <div className="mt-8 space-y-6">
        {/* Platform agent access switch */}
        <div className={cardClass}>
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <ZapIcon className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Global agent access</h3>
              </div>
              <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
                Master kill switch for all agent access across the platform. When disabled, no agent can make any
                calls regardless of organization-level settings. Existing grants remain but are blocked at the
                authorization choke point.
              </p>
            </div>
            <button
              onClick={handleToggle}
              className={`${switchBase} ${settings?.agentAccessEnabled ? switchOn : switchOff}`}
              role="switch"
              aria-checked={settings?.agentAccessEnabled}
              aria-label="Toggle global agent access"
            >
              <span className={`${thumb} ${settings?.agentAccessEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>
        </div>

        {/* Platform stats */}
        <div className="grid gap-4 md:grid-cols-3">
          <div className={cardClass}>
            <div className="flex items-center gap-2">
              <UsersIcon className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Active grants</h3>
            </div>
            <p className="mt-2 text-3xl font-bold text-gray-900 dark:text-white">{stats?.grantCount ?? 0}</p>
            <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
              Organization grants currently active
            </p>
          </div>

          <div className={cardClass}>
            <div className="flex items-center gap-2">
              <BarChart2Icon className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Total tool calls</h3>
            </div>
            <p className="mt-2 text-3xl font-bold text-gray-900 dark:text-white">{stats?.callCount ?? 0}</p>
            <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
              All-time agent tool invocations
            </p>
          </div>

          <div className={cardClass}>
            <div className="flex items-center gap-2">
              <ZapIcon className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Current access tokens</h3>
            </div>
            <p className="mt-2 text-3xl font-bold text-gray-900 dark:text-white">{stats?.currentTokens ?? 0}</p>
            <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
              Valid access tokens in circulation (15 min lifetime)
            </p>
          </div>
        </div>

        {/* Danger zone: revoke all grants */}
        <div className={cardClass} style={{ borderColor: 'rgb(254 202 202)', backgroundColor: 'rgb(254 242 242)' }}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <AlertTriangleIcon className="h-5 w-5 text-red-600 dark:text-red-400" />
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Revoke all grants</h3>
              </div>
              <p className="mt-2 text-sm text-gray-600 dark:text-slate-400">
                This will <strong>immediately revoke every active agent grant</strong> across all organizations on the
                platform. All connected agents will lose access. This action cannot be undone — users must reconnect
                their agents from scratch. An audit row is written for each revocation.
              </p>
            </div>
            <button
              onClick={handleRevokeAll}
              className={dangerBtn}
            >
              <Trash2Icon className="h-4 w-4 mr-1" />
              Revoke all grants
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PlatformSettingsPageWithReauth() {
  return (
    <ReauthProvider>
      <PlatformSettingsPage />
    </ReauthProvider>
  );
}
