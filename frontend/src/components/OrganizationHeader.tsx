import Link from 'next/link';
import LogoBox from './LogoBox';
import { resolveAssetUrl } from '../lib/assets';

export interface OrganizationHeaderProps {
  organization: { id?: string | null; name: string; logoUrl?: string | null };
  /**
   * Render the name as the page's h1 (organization page) or as plain text
   * linking back to the organization page (event, checkout, apply pages).
   */
  as?: 'h1' | 'link';
}

/**
 * Full-width organization identity strip shown at the top of every public
 * storefront page: logo (80px, 96px from sm) next to the organization name.
 */
export default function OrganizationHeader({ organization, as = 'link' }: OrganizationHeaderProps) {
  const logoSrc = organization.logoUrl ? resolveAssetUrl(organization.logoUrl) : null;
  const href = organization.id ? `/organizations/${organization.id}` : null;
  const nameClass = 'min-w-0 break-words text-2xl font-bold text-gray-900 dark:text-slate-100 sm:text-3xl';

  const logo = logoSrc && (
    <LogoBox src={logoSrc} alt={`${organization.name} logo`} className="w-20 shrink-0 rounded-lg shadow-sm sm:w-24" />
  );

  return (
    <header
      data-testid="organization-header"
      className="w-full border-b border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-800"
    >
      <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
        {as === 'h1' ? (
          <div className="flex items-center gap-4 sm:gap-6">
            {logo}
            <h1 className={nameClass}>{organization.name}</h1>
          </div>
        ) : href ? (
          <Link href={href} className="flex items-center gap-4 sm:gap-6 hover:opacity-90 transition-opacity">
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
    </header>
  );
}
