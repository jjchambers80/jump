'use client';

// Footer for client-rendered storefront pages: fetches the footer menu and
// renders FooterMenu. Renders nothing when the footer menu has no
// renderable items and no store policy is published. Themed pages use the theme Footer section instead.

import FooterMenu from './FooterMenu';
import { useStorefrontMenus } from './useStorefrontMenus';

interface StorefrontFooterProps {
  organization: { id: string; name: string };
}

export default function StorefrontFooter({ organization }: StorefrontFooterProps) {
  const menus = useStorefrontMenus(organization.id);
  const items = menus?.footer ?? [];
  const policies = menus?.policies ?? [];
  if (!items.length && !policies.length) return null;
  return <FooterMenu items={items} organization={organization} policies={policies} />;
}
