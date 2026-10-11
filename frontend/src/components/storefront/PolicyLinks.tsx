// Spec 052: links to the organization's published written policies (Settings ›
// Policies), under the storefront footer and at checkout. No hooks, so the
// themed footer can render it on the server.

import Link from 'next/link';
import type { PolicyLink } from '@/lib/menus';
import { storefrontHref } from '@/lib/storefrontPath';

interface PolicyLinksProps {
  policies: PolicyLink[] | undefined;
  /** Custom-domain host when rendered on the server. */
  host?: string | null;
  className?: string;
  linkClassName?: string;
}

export default function PolicyLinks({ policies, host, className = '', linkClassName = '' }: PolicyLinksProps) {
  if (!policies?.length) return null;
  return (
    <ul aria-label="Store policies" data-testid="policy-links" className={`flex flex-wrap gap-x-5 gap-y-1 ${className}`}>
      {policies.map((policy) => (
        <li key={policy.type}>
          <Link href={storefrontHref(policy.href, host)} className={linkClassName}>
            {policy.title}
          </Link>
        </li>
      ))}
    </ul>
  );
}
