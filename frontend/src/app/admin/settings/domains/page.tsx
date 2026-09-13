// Settings › Domains (spec 007 phase 3)
// Organizations point their own hostname at Jump: add it, publish the CNAME +
// TXT records shown here, then verify. ACTIVE domains serve the storefront and
// are used for links in emails and Stripe redirects.
'use client';

import { useCallback, useEffect, useState } from 'react';
import api from '@/services/api';
import { useOrg } from '@/components/OrgContext';
import SettingsNav from '../SettingsNav';

type DomainStatus = 'PENDING' | 'VERIFIED' | 'ACTIVE' | 'FAILED';

interface DnsRecord {
  type: 'CNAME' | 'TXT';
  name: string;
  value: string;
}

interface StorefrontDomain {
  id: string;
  hostname: string;
  status: DomainStatus;
  isPrimary: boolean;
  verifiedAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  createdAt: string;
  dnsRecords: DnsRecord[];
  tlsManagedByRailway: boolean;
}

const cardClass = 'rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-5';
const inputClass =
  'w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-900 dark:text-white';
const primaryBtn =
  'rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60';
const subtleBtn =
  'rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700';

const STATUS_STYLE: Record<DomainStatus, string> = {
  PENDING: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  VERIFIED: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  ACTIVE: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  FAILED: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
};
const STATUS_HELP: Record<DomainStatus, string> = {
  PENDING: 'Add the DNS records below, then verify. DNS changes can take up to an hour to propagate.',
  VERIFIED: 'DNS is correct. Waiting for the TLS certificate; this usually completes within a few minutes.',
  ACTIVE: 'Live. Your storefront, buyer emails, and payment redirects use this hostname.',
  FAILED: 'DNS records have been missing for more than 72 hours. Restore them and verify again.',
};

function formatWhen(value: string | null) {
  if (!value) return 'never';
  return new Date(value).toLocaleString();
}

function CopyValue({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex max-w-full items-center gap-2">
      <code className="truncate rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-900 dark:bg-slate-900 dark:text-slate-100">{value}</code>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard?.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
        className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
        aria-label={`Copy ${value}`}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </span>
  );
}

export default function DomainsSettingsPage() {
  const { selectedOrgId } = useOrg();
  const [domains, setDomains] = useState<StorefrontDomain[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hostname, setHostname] = useState('');
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // SYSTEM_ADMIN has no membership; the backend uses ?organizationId= for them
  // and ignores it for scoped staff.
  const qs = selectedOrgId ? `?organizationId=${encodeURIComponent(selectedOrgId)}` : '';

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await api.get<{ domains: StorefrontDomain[] }>(`/admin/settings/domains${qs}`);
      setDomains(data.domains);
    } catch (err: any) {
      setDomains([]);
      setError(err.status === 404 ? 'No organization is assigned to this account.' : err.message || 'Could not load domains');
    }
  }, [qs]);

  useEffect(() => {
    load();
  }, [load]);

  const replace = (d: StorefrontDomain) =>
    setDomains((prev) => (prev || []).map((x) => (x.id === d.id ? d : x.isPrimary && d.isPrimary ? { ...x, isPrimary: false } : x)));

  const addDomain = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hostname.trim()) return;
    setAdding(true);
    setError(null);
    try {
      const created = await api.post<StorefrontDomain>(`/admin/settings/domains${qs}`, { hostname: hostname.trim() });
      setDomains((prev) => [...(prev || []), created]);
      setHostname('');
      setNotice(`${created.hostname} added. Publish the DNS records, then verify.`);
    } catch (err: any) {
      setError(err.message || 'Could not add domain');
    } finally {
      setAdding(false);
    }
  };

  const verify = async (d: StorefrontDomain) => {
    setBusyId(d.id);
    try {
      const updated = await api.post<StorefrontDomain>(`/admin/settings/domains/${d.id}/verify${qs}`, {});
      replace(updated);
      setNotice(updated.status === 'ACTIVE' ? `${updated.hostname} is live.` : `${updated.hostname}: ${updated.status.toLowerCase()}.`);
    } catch (err: any) {
      setError(err.message || 'Verification failed');
    } finally {
      setBusyId(null);
    }
  };

  const makePrimary = async (d: StorefrontDomain) => {
    setBusyId(d.id);
    try {
      const updated = await api.post<StorefrontDomain>(`/admin/settings/domains/${d.id}/primary${qs}`, {});
      setDomains((prev) => (prev || []).map((x) => ({ ...x, isPrimary: x.id === updated.id })));
    } catch (err: any) {
      setError(err.message || 'Could not update primary domain');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (d: StorefrontDomain) => {
    if (!window.confirm(`Remove ${d.hostname}? Links already sent in emails to this host will stop working.`)) return;
    setBusyId(d.id);
    try {
      await api.delete(`/admin/settings/domains/${d.id}${qs}`);
      await load();
      setNotice(`${d.hostname} removed.`);
    } catch (err: any) {
      setError(err.message || 'Could not remove domain');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Settings</h1>
      <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">Manage your organization and business information.</p>

      <div className="mt-8 flex min-w-0 flex-col gap-6 md:flex-row md:items-start">
        <SettingsNav />

        <section aria-labelledby="domains-heading" className="min-w-0 flex-1 space-y-4">
          <div>
            <h2 id="domains-heading" className="text-lg font-semibold text-gray-900 dark:text-white">
              Domains
            </h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
              Sell tickets on your own domain. Point a subdomain such as <code>tickets.yourvenue.com</code> at Jump and your
              event pages, checkout, confirmation emails, and buyer sign-in all use it.
            </p>
          </div>

          {error && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
              {error}
            </div>
          )}

          <form onSubmit={addDomain} className={cardClass}>
            <label htmlFor="new-hostname" className="block text-sm font-semibold text-gray-900 dark:text-white">
              Add a domain
            </label>
            <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
              Use a subdomain (for example <code>tickets.yourvenue.com</code>). Apex domains such as <code>yourvenue.com</code> cannot be pointed with a CNAME.
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                id="new-hostname"
                className={inputClass}
                placeholder="tickets.yourvenue.com"
                value={hostname}
                onChange={(e) => setHostname(e.target.value)}
                disabled={adding}
                autoComplete="off"
                spellCheck={false}
              />
              <button type="submit" className={primaryBtn} disabled={adding || !hostname.trim()}>
                {adding ? 'Adding…' : 'Add domain'}
              </button>
            </div>
          </form>

          {domains === null ? (
            <div className={`${cardClass} animate-pulse h-24`} aria-label="Loading domains" />
          ) : domains.length === 0 ? (
            <p className="text-sm text-gray-600 dark:text-slate-400">No domains yet. Your storefront is served on the Jump domain.</p>
          ) : (
            domains.map((d) => (
              <article key={d.id} className={cardClass} aria-label={d.hostname}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold text-gray-900 dark:text-white">{d.hostname}</h3>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[d.status]}`}>{d.status}</span>
                    {d.isPrimary && (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-700 dark:bg-slate-700 dark:text-slate-200">
                        Primary
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={subtleBtn} onClick={() => verify(d)} disabled={busyId === d.id}>
                      {busyId === d.id ? 'Checking…' : 'Verify now'}
                    </button>
                    {!d.isPrimary && (
                      <button type="button" className={subtleBtn} onClick={() => makePrimary(d)} disabled={busyId === d.id}>
                        Make primary
                      </button>
                    )}
                    <button
                      type="button"
                      className={`${subtleBtn} text-red-700 dark:text-red-300`}
                      onClick={() => remove(d)}
                      disabled={busyId === d.id}
                    >
                      Remove
                    </button>
                  </div>
                </div>

                <p className="mt-2 text-sm text-gray-600 dark:text-slate-400">{STATUS_HELP[d.status]}</p>
                {d.lastError && d.status !== 'ACTIVE' && (
                  <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">Last check: {d.lastError}</p>
                )}

                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="text-xs uppercase text-gray-500 dark:text-slate-400">
                      <tr>
                        <th className="py-1 pr-4 font-medium">Type</th>
                        <th className="py-1 pr-4 font-medium">Name</th>
                        <th className="py-1 font-medium">Value</th>
                      </tr>
                    </thead>
                    <tbody className="text-gray-900 dark:text-slate-100">
                      {d.dnsRecords.map((r) => (
                        <tr key={r.type} className="border-t border-gray-100 dark:border-slate-700">
                          <td className="py-2 pr-4 font-mono text-xs">{r.type}</td>
                          <td className="py-2 pr-4"><CopyValue value={r.name} /></td>
                          <td className="py-2"><CopyValue value={r.value} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <p className="mt-3 text-xs text-gray-500 dark:text-slate-400">
                  Last checked {formatWhen(d.lastCheckedAt)}
                  {d.verifiedAt ? ` · verified ${formatWhen(d.verifiedAt)}` : ''}
                  {d.tlsManagedByRailway ? ' · certificate managed automatically' : ''}
                </p>
              </article>
            ))
          )}
        </section>
      </div>

      <div role="status" aria-live="polite" className="sr-only">{notice}</div>
    </div>
  );
}
