'use client';

import Link from 'next/link';
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
   * Render the organization's main menu (spec 027): a nav row under the
   * identity on desktop, a hamburger drawer on mobile. Off on focused flows
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

/**
 * Full-width organization identity strip shown at the top of every public
 * storefront page: logo (80px, 96px from sm) next to the organization name.
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
  // text-2xl wrapped a normal-length org name onto three lines next to the 80px
  // logo on a 390px screen; step up with the viewport instead.
  const nameClass =
    'min-w-0 break-words text-xl font-bold text-gray-900 dark:text-slate-100 sm:text-2xl lg:text-3xl';
  const containerClass = 'mx-auto max-w-7xl px-4 py-4 sm:px-6 sm:py-6 lg:px-8';

  const logo = logoSrc && (
    <LogoBox
      src={logoSrc}
      alt={`${organization.name} logo`}
      className="w-20 shrink-0 rounded-lg shadow-sm sm:w-24"
    />
  );

  return (
    <header
      data-testid="organization-header"
      className="w-full border-b border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-800"
    >
      <div className={containerClass}>
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            {as === 'h1' ? (
              <div className="flex items-center gap-4 sm:gap-6">
                {logo}
                <h1 className={nameClass}>{organization.name}</h1>
              </div>
            ) : href ? (
              <Link
                href={href}
                className="flex items-center gap-4 sm:gap-6 hover:opacity-90 transition-opacity"
              >
                {logo}
                <span className={nameClass}>{organization.name}</span>
              </Link>
            ) : (
              <div className="flex items-center gap-4 sm:gap-6">
                {logo}
                <span className={nameClass}>{organization.name}</span>
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {signIn && accountHref && !buyerLoading && (
              <Link
                href={accountHref}
                data-testid="buyer-sign-in-link"
                className="inline-flex min-h-[2.75rem] items-center gap-1.5 rounded-md px-3 text-sm font-semibold text-brand-link transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                  <circle cx="10" cy="6.5" r="3" />
                  <path d="M4 17v-1a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v1" />
                </svg>
                {buyer ? 'Account' : 'Sign in'}
              </Link>
            )}
            {navItems.length > 0 && organization.id && (
              <StorefrontNav
                orgId={organization.id}
                items={navItems}
                variant="mobile"
                className="md:hidden"
              />
            )}
          </div>
        </div>
        {navItems.length > 0 && organization.id && (
          <div className="mt-3 hidden md:block">
            <StorefrontNav orgId={organization.id} items={navItems} />
          </div>
        )}
      </div>
    </header>
  );
}