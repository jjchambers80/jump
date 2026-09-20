export const SEARCH_GROUP_ORDER = [
  'EVENT',
  'VENUE',
  'CUSTOMER',
  'ORDER',
  'TICKET',
  'APPLICATION',
  'PAGE',
  'BLOG_POST',
  'FILE',
] as const;

export type AdminSearchType = (typeof SEARCH_GROUP_ORDER)[number];

export interface AdminSearchRow {
  type: AdminSearchType;
  id: string;
  title: string;
  subtitle: string;
  href: string;
  meta?: Record<string, string | null>;
}

export interface AdminSearchResponse {
  query: string;
  total: number;
  data: AdminSearchRow[];
}

export const GROUP_LABEL: Record<AdminSearchType, string> = {
  EVENT: 'Events',
  VENUE: 'Venues',
  CUSTOMER: 'Customers',
  ORDER: 'Orders',
  TICKET: 'Tickets',
  APPLICATION: 'Applications',
  PAGE: 'Pages',
  BLOG_POST: 'Blog posts',
  FILE: 'Files',
};

const GROUP_LIST_PATH: Record<AdminSearchType, string> = {
  EVENT: '/admin/events',
  VENUE: '/admin/venues',
  CUSTOMER: '/admin/customers',
  ORDER: '/admin/orders',
  TICKET: '/admin/orders',
  APPLICATION: '/admin/participants',
  PAGE: '/admin/online-store/pages',
  BLOG_POST: '/admin/content/blog-posts',
  FILE: '/admin/content/files',
};

const SEARCH_PARAM: Partial<Record<AdminSearchType, 'search' | 'q'>> = {
  APPLICATION: 'q',
};

export function viewAllHref(type: AdminSearchType, query: string): string {
  const path = GROUP_LIST_PATH[type];
  const param = SEARCH_PARAM[type];
  return param ? `${path}?${param}=${encodeURIComponent(query.trim())}` : path;
}
