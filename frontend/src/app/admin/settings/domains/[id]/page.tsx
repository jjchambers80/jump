// Settings › Domains › <hostname> (spec 008)
// Per-domain setup page: status, DNS provider link, the three-step checklist
// with the records to publish, and More actions (make primary, delete).
// Polls verify while the domain is not yet connected.
'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import SettingsNav from '../../SettingsNav';
import { ChevronDownIcon, ChevronRightIcon, DomainIcon, ExternalLinkIcon, TrashIcon } from '../../icons';
import SetupChecklist from '../SetupChecklist';
import StatusPill from '../StatusPill';
import { useDomainApi, describeError } from '../useDomainApi';
import type { StorefrontDomain } from '../types';

const POLL_MS = 60 * 1000;
const cardClass = 'rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-6';
const secondaryBtn =
  'inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700';

function formatWhen(value: string | null) {
  if (!value) return 'never';
  return new Date(value).toLocaleString();
}

interface MoreActionsMenuProps {
  domain: StorefrontDomain;
  busy: boolean;
  onMakePrimary: () => void;
  onDelete: () => void;
}

function MoreActionsMenu({ domain, busy, onMakePrimary, onDelete }: MoreActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onClick = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node) && !buttonRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  const item =
    'flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50 focus:bg-gray-50 focus:outline-none dark:hover:bg-slate-700 dark:focus:bg-slate-700';

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        className={secondaryBtn}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="domain-more-actions"
        disabled={busy}
        onClick={() => setOpen((v) => !v)}
      >
        More actions
        <ChevronDownIcon />
      </button>
      {open && (
        <div
          ref={menuRef}
          id="domain-more-actions"
          role="menu"
          aria-label="More actions"
          className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800"
        >
          {!domain.isPrimary && (
            <button
              type="button"
              role="menuitem"
              className={`${item} text-gray-800 dark:text-slate-100`}
              onClick={() => {
                setOpen(false);
                onMakePrimary();
              }}
            >
              Make primary
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className={`${item} text-red-700 dark:text-red-300`}
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
          >
            <TrashIcon />
            Delete domain
          </button>
        </div>
      )}
    </div>
  );
}

export default function DomainSetupPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const domainApi = useDomainApi();
  const [domain, setDomain] = useState<StorefrontDomain | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string>('');
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setDomain(await domainApi.get(id));
      setError(null);
    } catch (err) {
      setError(describeError(err, 'Could not load this domain'));
    }
  }, [domainApi, id]);

  useEffect(() => {
    load();
  }, [load]);

  const check = useCallback(
    async (announce: boolean) => {
      setChecking(true);
      try {
        const updated = await domainApi.verify(id);
        setDomain(updated);
        setError(null);
        if (announce) {
          setNotice(
            updated.status === 'ACTIVE'
              ? `${updated.hostname} is connected.`
              : updated.status === 'VERIFIED'
                ? `${updated.hostname}: DNS verified, waiting for the certificate.`
                : `${updated.hostname}: DNS records not found yet. ${updated.lastError || ''}`
          );
        }
      } catch (err) {
        if (announce) setError(describeError(err, 'Check failed. Try again in a moment.'));
      } finally {
        setChecking(false);
      }
    },
    [domainApi, id]
  );

  // Poll while the domain is still being set up and the tab is visible. The
  // backend also sweeps every 10 minutes and applies a short cooldown per check.
  const terminal = !domain || domain.status === 'ACTIVE' || domain.status === 'FAILED';
  useEffect(() => {
    if (terminal) return;
    const tick = () => {
      if (document.visibilityState === 'visible') check(false);
    };
    const timer = setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [terminal, check]);

  const makePrimary = async () => {
    if (!domain) return;
    setBusy(true);
    try {
      setDomain(await domainApi.makePrimary(domain.id));
      setNotice(`${domain.hostname} is now the primary domain.`);
    } catch (err) {
      setError(describeError(err, 'Could not update the primary domain'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!domain) return;
    if (!window.confirm(`Delete ${domain.hostname}? Links already sent in emails to this host will stop working.`)) return;
    setBusy(true);
    try {
      await domainApi.remove(domain.id);
      router.replace('/admin/settings/domains');
    } catch (err) {
      setError(describeError(err, 'Could not delete the domain'));
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Settings</h1>
      <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">Manage your organization and business information.</p>

      <div className="mt-8 flex min-w-0 flex-col gap-6 md:flex-row md:items-start">
        <SettingsNav />

        <section aria-labelledby="domain-heading" className="min-w-0 flex-1 space-y-4">
          <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm text-gray-500 dark:text-slate-400">
            <Link href="/admin/settings/domains" className="inline-flex items-center gap-1 hover:underline">
              <DomainIcon className="h-4 w-4" />
              Domains
            </Link>
            <ChevronRightIcon className="h-3.5 w-3.5" />
          </nav>

          {error && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
              {error}
            </div>
          )}

          {!domain ? (
            !error && <div className={`${cardClass} h-40 animate-pulse`} aria-label="Loading domain" />
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 id="domain-heading" className="flex flex-wrap items-center gap-2 text-xl font-semibold text-gray-900 dark:text-white">
                    <span className="break-all">{domain.hostname}</span>
                    <StatusPill status={domain.status} />
                    {domain.isPrimary && (
                      <span className="rounded-full border border-gray-300 px-2 py-0.5 text-xs font-medium text-gray-700 dark:border-slate-600 dark:text-slate-200">
                        Primary
                      </span>
                    )}
                  </h2>
                  <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
                    {domain.dnsProvider ? `Managed by ${domain.dnsProvider.name}` : `DNS zone ${domain.zone}`}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {domain.dnsProvider && (
                    <a href={domain.dnsProvider.dnsConsoleUrl} target="_blank" rel="noreferrer" className={secondaryBtn}>
                      <ExternalLinkIcon />
                      Log in to {domain.dnsProvider.name}
                      <span className="sr-only">(opens in a new tab)</span>
                    </a>
                  )}
                  <MoreActionsMenu domain={domain} busy={busy} onMakePrimary={makePrimary} onDelete={remove} />
                </div>
              </div>

              {domain.status === 'FAILED' && (
                <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
                  DNS records for this domain have been missing since {formatWhen(domain.failingSince)}. Restore them below and check
                  again; the storefront falls back to your Jump URL until then.
                </div>
              )}

              {domain.status === 'ACTIVE' && (
                <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300">
                  Live at{' '}
                  <a href={`https://${domain.hostname}/`} target="_blank" rel="noreferrer" className="font-semibold underline">
                    https://{domain.hostname}/
                  </a>
                  . Your storefront, buyer emails, and payment redirects use this hostname
                  {domain.isPrimary ? '' : ' once it is primary'}.
                </div>
              )}

              <div className={cardClass}>
                <SetupChecklist domain={domain} checking={checking} onCheck={() => check(true)} />
              </div>

              <p className="text-xs text-gray-500 dark:text-slate-400">
                Last checked {formatWhen(domain.lastCheckedAt)}
                {domain.verifiedAt ? ` · verified ${formatWhen(domain.verifiedAt)}` : ''} · checks run automatically every 10 minutes.
              </p>
            </>
          )}
        </section>
      </div>

      <div role="status" aria-live="polite" className="sr-only">
        {notice}
      </div>
    </div>
  );
}
