// Theme Header section (spec 038 §7, locked). Wraps OrganizationHeader, the
// one header every storefront page uses, with server-resolved menus.

import OrganizationHeader from '@/components/OrganizationHeader';
import { withImageDimensions } from '@/lib/assets';
import { schemeClass } from '../settingsCss';
import type { SectionContext } from './context';
import StickyOnScrollUp from './StickyOnScrollUp';

export interface HeaderSectionProps {
  logoPosition?: 'left' | 'center';
  sticky?: 'off' | 'always' | 'scroll-up';
  separator?: boolean;
  showAccountLink?: boolean;
  colorScheme?: string;
  ctx: SectionContext;
}

export default function HeaderSection({
  logoPosition = 'left',
  sticky = 'off',
  separator = false,
  showAccountLink = true,
  colorScheme,
  ctx,
}: HeaderSectionProps) {
  const { organization, resolved, settings } = ctx;
  const logoFileId = settings.logo?.image?.fileId as string | undefined;
  const logoFile = logoFileId ? resolved.files[logoFileId] : undefined;
  // Theme logo files know their size: carry it so the header reserves the logo's box.
  const logoUrl = (logoFile?.url && withImageDimensions(logoFile.url, logoFile.width, logoFile.height)) || organization.logoUrl;
  const header = (
    <div
      data-section="Header"
      className={[
        schemeClass(colorScheme),
        separator ? 'border-b border-gray-200 dark:border-slate-700' : '',
        sticky === 'always' ? 'sticky top-0 z-40 bg-gray-50/95 backdrop-blur dark:bg-slate-900/95' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <OrganizationHeader
        organization={{ id: organization.id, name: organization.name, logoUrl }}
        organizationSlug={organization.slug}
        as={ctx.nameIsHeading ? 'h1' : 'link'}
        nav
        menus={resolved.menus}
        signIn={showAccountLink && organization.buyerSignInLinks !== false}
        logoPosition={logoPosition}
      />
    </div>
  );
  return sticky === 'scroll-up' ? <StickyOnScrollUp>{header}</StickyOnScrollUp> : header;
}
