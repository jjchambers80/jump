'use client';

import Link from 'next/link';
import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import LogoBox from './LogoBox';
import { resolveAssetUrl } from '../lib/assets';
import StorefrontNav from './storefront/StorefrontNav';
import { useStorefrontMenus } from './storefront/useStorefrontMenus';
import { storefrontHref } from '../lib/storefrontPath';
import { useBuyer } from '../lib/useBuyer';
import type { PublicMenus } from '../lib/menus';

/**
 * The organization's theme Logo settings (backend `storefrontLogoFor`), sent
 * with the payloads of pages the theme frame does not render (checkout,
 * confirmation, apply, map, account) so their header matches the themed pages.
 */
export interface StorefrontLogo {
  /** The theme's logo image (overrides the organization logo), or null. */
  url: string | null;
  desktopWidth: number;
  mobileWidth: number;
  /** The theme's button corner radius in px (9999 = pill). */
  buttonRadius?: number;
}

export interface OrganizationHeaderProps {
  organization: { id?: string | null; name: string; logoUrl?: string | null; storefrontLogo?: StorefrontLogo | null };
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
  /**
   * Themed storefront (spec 038): menus resolved on the server. The header
   * then renders them at once instead of fetching after hydration.
   */
  menus?: PublicMenus;
  /**
   * Theme Header section. `center` (default): menu flush left, logo centred,
   * sign-in flush right. `left`: logo on the left, menu and sign-in on the right.
   */
  logoPosition?: 'left' | 'center';
  /**
   * `bar`: the slim full-width header of map pages. Menu button always (drawer
   * from the left), then the logo flush left, sign-in flush right, and an
   * optional `subheader` row (event summary) under them.
   */
  layout?: 'standard' | 'bar';
  /** Bar layout only: the row under the bar, aligned with the menu button. */
  subheader?: ReactNode;
}

// Skip link: moves focus to the themed page body (#storefront-main, spec 038)
// or else to whatever the page renders right after the header, so legacy
// pages need no agreed id.
function skipToContent(event: MouseEvent<HTMLAnchorElement>) {
  const header = event.currentTarget.closest('header');
  const target = (document.getElementById('storefront-main') ?? header?.nextElementSibling) as HTMLElement | null;
  if (!target) return;
  event.preventDefault();
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
  target.focus();
}

/**
 * Organization identity row at the top of every public storefront page:
 * main menu on the left, logo (or the name when there is no logo) centred,
 * sign-in on the right. Minimal on purpose: no background or border of its
 * own, it sits on the page surface.
 */
export default function OrganizationHeader({
  organization,
  organizationSlug,
  as = 'link',
  nav = false,
  signIn = false,
  menus: serverMenus,
  logoPosition = 'center',
  layout = 'standard',
  subheader,
}: OrganizationHeaderProps) {
  const fetchedMenus = useStorefrontMenus(nav && !serverMenus ? organization.id : null);
  const menus = serverMenus ?? fetchedMenus;
  const navItems = nav && organization.id ? (menus?.main ?? []) : [];
  const { buyer, loading: buyerLoading } = useBuyer(signIn ? organization.id : null);
  const orgSlug = organizationSlug ?? organization.id ?? '';
  const accountHref = organization.id
    ? storefrontHref(`/organizations/${encodeURIComponent(orgSlug)}/account`, organization.id)
    : null;
  const storefrontLogo = organization.storefrontLogo;
  const rawLogo = storefrontLogo?.url || organization.logoUrl;
  const logoSrc = rawLogo ? resolveAssetUrl(rawLogo) : null;
  // Outside a theme frame: the theme's widths as the same CSS variables the frame sets.
  const logoVars = storefrontLogo
    ? ({
        '--theme-logo-width': `${storefrontLogo.desktopWidth}px`,
        '--theme-logo-width-mobile': `${storefrontLogo.mobileWidth}px`,
      } as CSSProperties)
    : undefined;
  const href = organization.id ? `/organizations/${encodeURIComponent(orgSlug)}` : null;
  const isHeading = as === 'h1';
  // With a logo the name is read by screen readers only; without one it is the visible identity.
  const nameClass = logoSrc
    ? 'sr-only'
    : // Same size whether or not the name is the page's h1: one header on every page.
      `min-w-0 break-words text-center font-semibold tracking-tight text-gray-900 dark:text-slate-100 ${
        layout === 'bar' ? 'text-base sm:text-lg' : 'text-xl sm:text-2xl'
      }`;
  // The bar sits on a dark band: a white ring reads on it whatever the brand colour.
  const focusRing = `focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent ${
    layout === 'bar' ? 'focus-visible:ring-white' : 'focus-visible:ring-brand'
  }`;
  const hasNav = navItems.length > 0 && !!organization.id;
  const isBar = layout === 'bar';

  const logo = logoSrc && (
    <LogoBox
      src={logoSrc}
      alt={`${organization.name} logo`}
      bare
      fit={isBar ? 'height' : 'width'}
      // Height follows the logo (a wordmark stays short, no square padding),
      // capped at the width so a tall logo cannot stretch the header either.
      imgClassName={isBar ? '' : 'max-h-[var(--theme-logo-width-mobile,90px)] sm:max-h-[var(--theme-logo-width,120px)]'}
      // One size on every page: the theme's Logo widths inside a ThemeScope,
      // otherwise the same defaults (packages/theme/src/settings.js: 90 / 120 px).
      // The map bar is the one exception: a slim bar leaves the map the screen.
      className={
        isBar
          ? 'h-9 max-w-[9rem] shrink-0 sm:h-11 sm:max-w-[13rem]'
          : 'w-[var(--theme-logo-width-mobile,90px)] shrink-0 sm:w-[var(--theme-logo-width,120px)]'
      }
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

  const skipLink = (
    <a
      href="#"
      onClick={skipToContent}
      className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-gray-900 focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-brand dark:focus:bg-slate-800 dark:focus:text-slate-100"
    >
      Skip to content
    </a>
  );

  const signInLink = signIn && accountHref && !buyerLoading ? (
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
  ) : null;

  const identityLink = href && !isHeading ? (
    <Link
      href={href}
      className={`-m-1 flex w-fit max-w-full items-center gap-3 rounded-lg p-1 transition-opacity hover:opacity-80 motion-reduce:transition-none sm:gap-4 ${focusRing}`}
    >
      {identity}
    </Link>
  ) : (
    <div className="flex items-center gap-3 sm:gap-4">{identity}</div>
  );

  if (isBar) {
    // Map pages (Ticketmaster-style), inside EventMapHeader's dark band, which
    // owns the background: one slim full-width row, then the subheader row.
    return (
      <header
        data-testid="organization-header"
        data-layout="bar"
        className="relative w-full"
      >
        {skipLink}
        <div className="flex min-h-14 items-center gap-1 px-2 sm:gap-2 sm:px-4">
          {hasNav && (
            <StorefrontNav orgId={organization.id!} items={navItems} variant="mobile" side="left" />
          )}
          <div className="min-w-0 flex-1 py-1.5">{identityLink}</div>
          {signInLink && <div className="shrink-0">{signInLink}</div>}
        </div>
        {/* Same gutter as the row above: the back button sits under the menu button. */}
        {subheader && <div className="px-2 pb-3 sm:px-4">{subheader}</div>}
      </header>
    );
  }

  if (logoPosition === 'center') {
    // Equal side columns keep the logo on the page's centre line whatever the
    // menu and sign-in widths; the negative margins put the menu's first label
    // and the sign-in text (not their tap padding) on the page gutter.
    return (
      <header data-testid="organization-header" data-logo-position="center" className="relative w-full" style={logoVars}>
        {skipLink}
        <div className="mx-auto grid max-w-7xl grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 px-4 py-3 sm:gap-6 sm:px-6 sm:py-5 lg:px-8">
          {/* min-h-11: as tall as the controls, which appear after hydration. */}
          <div className="flex min-h-11 min-w-0 items-center justify-start">
            {hasNav && (
              <>
                <StorefrontNav orgId={organization.id!} items={navItems} side="left" className="hidden md:block" />
                <StorefrontNav
                  orgId={organization.id!}
                  items={navItems}
                  variant="mobile"
                  side="left"
                  className="-ml-2.5 md:hidden"
                />
              </>
            )}
          </div>
          <div className="flex min-w-0 justify-center">{identityLink}</div>
          <div className="flex min-h-11 min-w-0 items-center justify-end">
            {signInLink && <div className="-mr-3">{signInLink}</div>}
          </div>
        </div>
      </header>
    );
  }

  return (
    <header data-testid="organization-header" className="relative w-full" style={logoVars}>
      {skipLink}
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:gap-6 sm:px-6 sm:py-5 lg:px-8">
        {/* min-h-11: as tall as the menu / sign-in controls, which appear after
            hydration, so their arrival never changes the header's height. */}
        <div className="flex min-h-11 min-w-0 flex-1 items-center">{identityLink}</div>

        {hasNav && (
          <StorefrontNav orgId={organization.id!} items={navItems} className="hidden md:block" />
        )}

        {(signInLink || hasNav) && (
          <div className="flex shrink-0 items-center gap-1">
            {signInLink}
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
