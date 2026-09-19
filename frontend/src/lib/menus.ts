// Content › Menus (spec 027) — shared types and helpers.

export type MenuLinkType =
  | 'HOME'
  | 'EVENTS'
  | 'EVENT'
  | 'VENUE'
  | 'PAGE'
  | 'BLOG'
  | 'BLOG_POST'
  | 'ACCOUNT'
  | 'EXTERNAL';

export const MENU_MAX_DEPTH = 3;
export const MENU_LABEL_MAX = 60;

export const TARGET_LINK_TYPES: MenuLinkType[] = ['EVENT', 'VENUE', 'PAGE', 'BLOG', 'BLOG_POST'];

export const LINK_TYPE_LABELS: Record<MenuLinkType, string> = {
  HOME: 'Home page',
  EVENTS: 'All events',
  EVENT: 'Event',
  VENUE: 'Venue',
  PAGE: 'Page',
  BLOG: 'Blog',
  BLOG_POST: 'Blog post',
  ACCOUNT: 'Buyer account',
  EXTERNAL: 'External link',
};

export interface MenuTarget {
  title: string | null;
  status: 'ok' | 'missing' | 'hidden';
  href: string | null;
}

export interface MenuItemNode {
  id: string;
  label: string;
  linkType: MenuLinkType;
  targetId: string | null;
  url: string | null;
  newTab: boolean;
  target: MenuTarget;
  children: MenuItemNode[];
}

export interface Menu {
  id: string;
  title: string;
  handle: string;
  isDefault: boolean;
  items: MenuItemNode[];
  updatedAt: string;
}

export interface MenuSummary {
  id: string;
  title: string;
  handle: string;
  isDefault: boolean;
  itemLabels: string[];
  updatedAt: string;
}

/** What PUT /admin/menus/:id accepts. */
export interface MenuItemInput {
  label: string;
  linkType: MenuLinkType;
  targetId?: string | null;
  url?: string | null;
  newTab?: boolean;
  children?: MenuItemInput[];
}

export interface LinkTargetOption {
  id: string;
  title: string;
  hint?: string;
}

export interface LinkTargets {
  events: LinkTargetOption[];
  venues: LinkTargetOption[];
  pages: LinkTargetOption[];
  blogs: LinkTargetOption[];
  blogPosts: LinkTargetOption[];
}

export interface PublicMenuItem {
  id: string;
  label: string;
  href: string;
  newTab: boolean;
  children: PublicMenuItem[];
}

export interface PublicMenus {
  main: PublicMenuItem[];
  footer: PublicMenuItem[];
}

/** One-line description of where an item links, for the collapsed row. */
export function linkSummary(item: {
  linkType: MenuLinkType;
  url: string | null;
  target?: MenuTarget | null;
}) {
  if (item.linkType === 'EXTERNAL') return item.url ?? '';
  if (TARGET_LINK_TYPES.includes(item.linkType)) {
    return `${LINK_TYPE_LABELS[item.linkType]} › ${item.target?.title ?? '…'}`;
  }
  return LINK_TYPE_LABELS[item.linkType];
}

export function looksLikeUrl(value: string) {
  return (
    /^(https?:\/\/|mailto:|tel:)/i.test(value.trim()) ||
    /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(value.trim())
  );
}
