// Theme PageContent section: a full-width Content page's own body (title,
// text, template sections, Apply button) among the theme's sections. The
// page payload arrives resolved (`resolved.page`), like events and menus.

import StorefrontPageBody from '@/components/storefront/StorefrontPageBody';
import SectionShell from './SectionShell';
import type { SectionContext } from './context';

export interface PageContentProps {
  id: string;
  colorScheme?: string;
  paddingTop?: number;
  paddingBottom?: number;
  sectionWidth?: string;
  ctx: SectionContext;
}

export default function PageContentSection({ id: _id, ctx, ...common }: PageContentProps) {
  const page = ctx.resolved.page;
  if (!page) return null;
  return (
    <SectionShell type="PageContent" props={common}>
      <StorefrontPageBody page={page} organizationId={ctx.organization.id} as="div" />
    </SectionShell>
  );
}
