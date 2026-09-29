'use client';

// Footer for client-rendered storefront pages: fetches the footer menu and
// renders FooterMenu. Renders nothing when the footer menu has no
// renderable items. Themed pages use the theme Footer section instead.

import FooterMenu from './FooterMenu';
import { useStorefrontMenus } from './useStorefrontMenus';

interface StorefrontFooterProps {
  organization: { id: string; name: string };
}

export default function StorefrontFooter({ organization }: StorefrontFooterProps) {
  const menus = useStorefrontMenus(organization.id);
  const items = menus?.footer ?? [];
  if (!items.length) return null;
  return <FooterMenu items={items} organization={organization} />;
}
