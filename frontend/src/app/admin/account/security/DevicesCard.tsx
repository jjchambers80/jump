'use client';

// Account › Security › Devices (spec 030 D): every browser signed in to this
// account, with log out for one device or all the others.

import { useCallback, useEffect, useState } from 'react';
import { signOut } from 'next-auth/react';
import { Monitor, Smartphone, Tablet } from 'lucide-react';
import { useAccountFormat } from '@/lib/accountFormat';
import { AccountSession, accountApi } from '../accountApi';

const cardClass = 'rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-5';
const listClass = 'mt-4 divide-y divide-gray-200 overflow-hidden rounded-lg border border-gray-200 dark:divide-slate-700 dark:border-slate-700';
const secondaryButton =
  'rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700';

const GEOIP_ENABLED = process.env.NEXT_PUBLIC_GEOIP_ENABLED === 'true';

function DeviceIcon({ type }: { type: string | null }) {
  const className = 'h-5 w-5';
  if (type === 'mobile') return <Smartphone aria-hidden="true" className={className} />;
  if (type === 'tablet') return <Tablet aria-hidden="true" className={className} />;
  return <Monitor aria-hidden="true" className={className} />;
}

export function locationLabel(location: AccountSession['location']): string {
  if (!location) return 'Location unavailable';
  const parts = [location.city, location.region, location.country].filter(Boolean);
  return parts.length ? parts.join(', ') : 'Location unavailable';
}

/** "just now", "5 minutes ago", "3 days ago" — falls back to the absolute date past a week. */
export function relativeTime(iso: string, now: Date, format: (value: string) => string): string {
  const diffMs = now.getTime() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return format(iso);
}

export default function DevicesCard() {
  const { formatDateTime } = useAccountFormat();
  const [sessions, setSessions] = useState<AccountSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState('');

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await accountApi.sessions.list();
      setSessions(data.sessions);
    } catch (requestError: any) {
      setError(requestError.message || 'Unable to load your devices.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const logOut = async (session: AccountSession) => {
    const prompt = session.current
      ? 'Log out of this device? You will be sent to the sign-in page.'
      : `Log out ${session.device.label}? That device will need to sign in again.`;
    if (!window.confirm(prompt)) return;
    try {
      setBusy(session.id);
      await accountApi.sessions.revoke(session.id);
      if (session.current) {
        await signOut({ callbackUrl: '/auth/signin' });
        return;
      }
      setStatus(`${session.device.label} logged out.`);
      await load();
    } catch (requestError: any) {
      setError(requestError.message || 'Unable to log out that device.');
    } finally {
      setBusy(null);
    }
  };

  const logOutOthers = async () => {
    if (!window.confirm("Log out all other devices? You'll stay signed in on this device.")) return;
    try {
      setBusy('others');
      const result = await accountApi.sessions.revokeOthers();
      setStatus(result.revoked === 0 ? 'No other devices were signed in.' : `${result.revoked} other device${result.revoked === 1 ? '' : 's'} logged out.`);
      await load();
    } catch (requestError: any) {
      setError(requestError.message || 'Unable to log out other devices.');
    } finally {
      setBusy(null);
    }
  };

  const now = new Date();
  const others = sessions?.filter((s) => !s.current).length ?? 0;

  return (
    <div className={cardClass} data-testid="devices-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Devices</h3>
          <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
            You&apos;re currently logged in to Jump on these devices. If you don&apos;t recognize a device, log out to keep your account secure.
          </p>
        </div>
        <button type="button" onClick={logOutOthers} disabled={busy !== null || others === 0} className={secondaryButton}>
          {busy === 'others' ? 'Logging out…' : 'Log out all other devices'}
        </button>
      </div>

      {error && (
        <div role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
          {error}{' '}
          <button type="button" onClick={load} className="font-medium underline">Retry</button>
        </div>
      )}

      {!sessions && !error && (
        <div aria-label="Loading devices" className={`${listClass} animate-pulse`}>
          <div className="h-16 bg-gray-100 dark:bg-slate-700/70" />
        </div>
      )}

      {sessions && (
        <ul className={listClass}>
          {sessions.map((session) => (
            <li key={session.id} className="flex items-center gap-3 px-4 py-3.5" data-testid="device-row">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center text-gray-500 dark:text-slate-400">
                <DeviceIcon type={session.device.type} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-gray-900 dark:text-white">{session.device.label}</span>
                  {session.current && (
                    <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
                      This device
                    </span>
                  )}
                </span>
                <span className="block text-sm text-gray-600 dark:text-slate-400">
                  {locationLabel(session.location)} · Last active {relativeTime(session.lastSeenAt, now, (v) => formatDateTime(v))}
                </span>
              </span>
              <button
                type="button"
                onClick={() => logOut(session)}
                disabled={busy !== null}
                aria-label={`Log out ${session.current ? 'this device' : session.device.label}`}
                className={secondaryButton}
              >
                {busy === session.id ? 'Logging out…' : 'Log out'}
              </button>
            </li>
          ))}
        </ul>
      )}

      {sessions && others === 0 && (
        <p className="mt-3 text-xs text-gray-500 dark:text-slate-400">You&apos;re only signed in on this device.</p>
      )}
      {GEOIP_ENABLED && (
        <p className="mt-3 text-xs text-gray-500 dark:text-slate-400">Location data by MaxMind GeoLite2.</p>
      )}
      <div role="status" aria-live="polite" className="sr-only">{status}</div>
    </div>
  );
}
