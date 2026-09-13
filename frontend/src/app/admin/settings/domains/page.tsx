// Settings › Domains (spec 008)
// Shopify-style domain list: "Connect existing" opens a dialog that takes the
// hostname; Next lands on the domain's setup page with its DNS records.
// ACTIVE domains serve the storefront and are used for links in emails and
// Stripe redirects (spec 007 phase 3).
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import SettingsNav from '../SettingsNav';
import { DomainIcon } from '../icons';
import ConnectDomainDialog from './ConnectDomainDialog';
import DomainsTable from './DomainsTable';
import { useDomainApi, describeError } from './useDomainApi';
import type { StorefrontDomain } from './types';

const primaryBtn =
  'rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50';
const secondaryBtn =
  'rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700';

export default function DomainsSettingsPage() {
  const router = useRouter();
  const domainApi = useDomainApi();
  const [domains, setDomains] = useState<StorefrontDomain[] | null>(null);
  const [platformUrl, setPlatformUrl] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const connectBtnRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await domainApi.list();
      setDomains(data.domains);
      setPlatformUrl(data.platformUrl);
    } catch (err) {
      setDomains([]);
      setError(describeError(err, 'Could not load domains'));
    }
  }, [domainApi]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Settings</h1>
      <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">Manage your organization and business information.</p>

      <div className="mt-8 flex min-w-0 flex-col gap-6 md:flex-row md:items-start">
        <SettingsNav />

        <section aria-labelledby="domains-heading" className="min-w-0 flex-1 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="domains-heading" className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
              <DomainIcon className="h-5 w-5 text-gray-500 dark:text-slate-400" />
              Domains
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <button ref={connectBtnRef} type="button" className={secondaryBtn} onClick={() => setConnecting(true)}>
                Connect existing
              </button>
              <button type="button" className={primaryBtn} disabled title="Coming soon" aria-describedby="buy-domain-note">
                Buy new domain
              </button>
              <span id="buy-domain-note" className="sr-only">
                Buying domains is not available yet.
              </span>
            </div>
          </div>

          {error && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
              {error}
            </div>
          )}

          {domains === null ? (
            <div className="h-28 animate-pulse rounded-xl border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-800" aria-label="Loading domains" />
          ) : (
            <>
              <DomainsTable domains={domains} platformUrl={platformUrl} />
              {domains.length === 0 && (
                <p className="text-sm text-gray-600 dark:text-slate-400">
                  Sell tickets on your own domain. Connect a subdomain you already own, such as <code>tickets.yourvenue.com</code>, and
                  your event pages, checkout, confirmation emails, and buyer sign-in all use it.
                </p>
              )}
            </>
          )}

          <p className="pt-2 text-center text-sm">
            <a
              href="https://github.com/jjchambers80/jump/blob/main/docs/wiki/features/custom-domains.md"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-gray-700 hover:underline dark:text-slate-300"
            >
              Learn more about domains
            </a>
          </p>
        </section>
      </div>

      {connecting && (
        <ConnectDomainDialog
          returnFocusRef={connectBtnRef}
          onClose={() => setConnecting(false)}
          onConnected={(created) => {
            setConnecting(false);
            router.push(`/admin/settings/domains/${created.id}`);
          }}
        />
      )}
    </div>
  );
}
