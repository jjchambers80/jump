'use client';

import Link from 'next/link';
import type { MouseEvent } from 'react';
import LogoBox from './LogoBox';
import { resolveAssetUrl } from '../lib/assets';
import StorefrontNav from './storefront/StorefrontNav';
import { useStorefrontMenus } from './storefront/useStorefrontMenus';
import { storefrontHref } from '../lib/storefrontPath';
import { useBuyer } from '../lib/useBuyer';

export interface OrganizationHeaderProps {
  organization: { id?: string | null; name: string; logoUrl?: string | null };
  organizationSlug?: string | null;
  /**
   * Render the name as the page's h1 (organization page) or as plain text
   * linking back to the organization page (event, checkout, apply pages).
   */
  as?: 'h1' | 'link';
  /**
   * Render the organization's main menu (spec 027): inline beside the
   * identity from md, a hamburger drawer below it. Off on focused flows
   * (checkout, confirmation, apply, account).
   */
  nav?: boolean;
  /**
   * Show the buyer sign-in link (spec 031, Settings › Customer accounts):
   * "Sign in" when there is no buyer session for this organization,
   * "Account" when there is. Off on the account page itself and on focused
   * flows. Pages pass the organization's `buyerSignInLinks` flag.
   */
  signIn?: boolean;
}

// Skip link: moves focus to whatever the page renders right after the header,
// so no page has to agree on a #main id.
function skipToContent(event: MouseEvent<HTMLAnchorElement>) {
  const header = event.currentTarget.closest('header');
  const target = header?.nextElementSibling as HTMLElement | null;
  if (!target) return;
  event.preventDefault();
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
  target.focus();
}

/**
 * Organization identity row at the top of every public storefront page:
 * logo + name on the left, main menu and sign-in on the right. Minimal on
 * purpose: no background or border of its own, it sits on the page surface.
 */
export default function OrganizationHeader({
  organization,
  organizationSlug,
  as = 'link',
  nav = false,
  signIn = false,
}: OrganizationHeaderProps) {
  const menus = useStorefrontMenus(nav ? organization.id : null);
  const navItems = nav && organization.id ? (menus?.main ?? []) : [];
  const { buyer, loading: buyerLoading } = useBuyer(signIn ? organization.id : null);
  const orgSlug = organizationSlug ?? organization.id ?? '';
  const accountHref = organization.id
    ? storefrontHref(`/organizations/${encodeURIComponent(orgSlug)}/account`, organization.id)
    : null;
  const logoSrc = organization.logoUrl ? resolveAssetUrl(organization.logoUrl) : null;
  const href = organization.id ? `/organizations/${encodeURIComponent(orgSlug)}` : null;
  const isHeading = as === 'h1';
  const nameClass = `min-w-0 break-words font-semibold tracking-tight text-gray-900 dark:text-slate-100 ${
    isHeading ? 'text-xl sm:text-2xl' : 'text-base sm:text-lg'
  }`;
  const focusRing =
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-transparent';
  const hasNav = navItems.length > 0 && !!organization.id;

  const logo = logoSrc && (
    <LogoBox
      src={logoSrc}
      alt={`${organization.name} logo`}
      className={`shrink-0 rounded-lg ${isHeading ? 'w-14 sm:w-16' : 'w-10 sm:w-12'}`}
    />
  );

  const identity = (
    <>
      {logo}
      {isHeading ? (
        <h1 className={nameClass}>{organization.name}</h1>
      ) : (
        <span className={nameClass}>{organization.name}</span>
      )}
    </>
  );

  return (
    <header data-testid="organization-header" className="relative w-full">
      <a
        href="#"
        onClick={skipToContent}
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-gray-900 focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-brand dark:focus:bg-slate-800 dark:focus:text-slate-100"
      >
        Skip to content
      </a>
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:gap-6 sm:px-6 sm:py-5 lg:px-8">
        <div className="min-w-0 flex-1">
          {href && !isHeading ? (
            <Link
              href={href}
              className={`-m-1 inline-flex max-w-full items-center gap-3 rounded-lg p-1 transition-opacity hover:opacity-80 motion-reduce:transition-none sm:gap-4 ${focusRing}`}
            >
              {identity}
            </Link>
          ) : (
            <div className="flex items-center gap-3 sm:gap-4">{identity}</div>
          )}
        </div>

        {hasNav && (
          <StorefrontNav orgId={organization.id!} items={navItems} className="hidden md:block" />
        )}

        {((signIn && accountHref && !buyerLoading) || hasNav) && (
          <div className="flex shrink-0 items-center gap-1">
            {signIn && accountHref && !buyerLoading && (
              <Link
                href={accountHref}
                data-testid="buyer-sign-in-link"
                className={`inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-md px-2 text-sm font-medium text-gray-700 transition-colors hover:text-brand-link motion-reduce:transition-none dark:text-slate-200 sm:px-3 ${focusRing}`}
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-5 w-5 sm:h-4 sm:w-4"
                >
                  <circle cx="10" cy="6.5" r="3" />
                  <path d="M4 17v-1a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v1" />
                </svg>
                <span className="sr-only sm:not-sr-only">{buyer ? 'Account' : 'Sign in'}</span>
              </Link>
            )}
            {hasNav && (
              <StorefrontNav
                orgId={organization.id!}
                items={navItems}
                variant="mobile"
                className="md:hidden"
              />
            )}
          </div>
        )}
      </div>
    </header>
  );
}
