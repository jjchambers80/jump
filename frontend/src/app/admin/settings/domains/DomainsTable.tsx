'use client';

// Domain | Status table (spec 008). The primary custom domain comes first
// with the platform URL nested under it, the way Shopify nests the
// myshopify.com host; remaining domains follow. Rows link to the setup page.

import Link from 'next/link';
import { DomainIcon, GlobeIcon } from '../icons';
import StatusPill from './StatusPill';
import type { StorefrontDomain } from './types';

interface DomainsTableProps {
  domains: StorefrontDomain[];
  platformUrl: string;
}

const rowClass = 'flex items-center gap-3 px-4 py-3';
const nestedClass = 'flex items-center gap-3 py-3 pl-10 pr-4';

function PlatformRow({ platformUrl, nested }: { platformUrl: string; nested: boolean }) {
  const display = platformUrl.replace(/^https?:\/\//, '');
  return (
    <li className={`${nested ? nestedClass : rowClass} text-sm`} aria-label="Jump URL">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center text-gray-400 dark:text-slate-500">
        <DomainIcon />
      </span>
      <span className="min-w-0 flex-1">
        <a
          href={platformUrl}
          target="_blank"
          rel="noreferrer"
          className="block truncate font-medium text-gray-900 hover:underline dark:text-white"
          title="Your storefront on the Jump platform. Always available."
        >
          {display}
        </a>
        <span className="block truncate text-xs text-gray-500 dark:text-slate-400">Jump URL</span>
      </span>
      <StatusPill status="ACTIVE" />
    </li>
  );
}

function DomainRow({ domain, nested }: { domain: StorefrontDomain; nested: boolean }) {
  return (
    <li className={nested ? nestedClass : rowClass}>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center text-gray-500 dark:text-slate-400">
        {domain.isPrimary ? <GlobeIcon /> : <DomainIcon />}
      </span>
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <Link
          href={`/admin/settings/domains/${domain.id}`}
          className="truncate text-sm font-medium text-gray-900 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-white"
        >
          {domain.hostname}
        </Link>
        {domain.isPrimary && (
          <span className="rounded-full border border-gray-300 px-2 py-0.5 text-xs font-medium text-gray-700 dark:border-slate-600 dark:text-slate-200">
            Primary
          </span>
        )}
      </span>
      <StatusPill status={domain.status} />
    </li>
  );
}

export default function DomainsTable({ domains, platformUrl }: DomainsTableProps) {
  const primary = domains.find((d) => d.isPrimary) ?? null;
  const rest = domains.filter((d) => d !== primary);

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <div className="flex items-center gap-3 border-b border-gray-200 bg-gray-50 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
        <span className="flex-1">Domain</span>
        <span>Status</span>
      </div>
      <ul className="divide-y divide-dashed divide-gray-200 dark:divide-slate-700" aria-label="Domains">
        {primary ? (
          <>
            <DomainRow domain={primary} nested={false} />
            <PlatformRow platformUrl={platformUrl} nested />
          </>
        ) : (
          <PlatformRow platformUrl={platformUrl} nested={false} />
        )}
        {rest.map((d) => (
          <DomainRow key={d.id} domain={d} nested={false} />
        ))}
      </ul>
    </div>
  );
}
