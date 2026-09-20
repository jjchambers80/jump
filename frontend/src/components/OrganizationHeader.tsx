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
  /**
   * Render the name as the page's h1 (organization page) or as plain text
   * linking back to the organization page (event, checkout, apply pages).
   */
  as?: 'h1' | 'link';
  /**
   * `centered` (default): identity sits in a centered max-w-7xl container.
   * `two-column`: at xl the container is right-aligned and capped at the
   * organization page's event column (max-w-4xl) plus cover column
   * (max-w-3xl) so the logo lines up with the event cards below it.
   */
  layout?: 'centered' | 'two-column';
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
  as = 'link',
  layout = 'centered',
  nav = false,
  signIn = false,
}: OrganizationHeaderProps) {
  const menus = useStorefrontMenus(nav ? organization.id : null);
  const navItems = nav && organization.id ? (menus?.main ?? []) : [];
  const { buyer, loading: buyerLoading } = useBuyer(signIn ? organization.id : null);
  const accountHref = organization.id ? storefrontHref(`/organizations/${organization.id}/account`, organization.id) : null;
  const logoSrc = organization.logoUrl ? resolveAssetUrl(organization.logoUrl) : null;
  const href = organization.id ? `/organizations/${organization.id}` : null;
  const nameClass =
    'min-w-0 break-words text-2xl font-bold text-gray-900 dark:text-slate-100 sm:text-3xl';
  const containerClass =
    layout === 'two-column'
      ? 'mx-auto max-w-7xl px-4 py-4 sm:px-6 sm:py-6 lg:px-8 xl:mr-0 xl:max-w-[104rem] xl:px-6'
      : 'mx-auto max-w-7xl px-4 py-4 sm:px-6 sm:py-6 lg:px-8';

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
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-semibold text-brand-link hover:opacity-80 transition-opacity"
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
