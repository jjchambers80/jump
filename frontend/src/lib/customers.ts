export type CustomerSegment = 'Prospect' | 'New' | 'Repeat' | 'Lapsed';

export interface CustomerListState {
  page?: number;
  search?: string;
  tag?: string;
  segment?: CustomerSegment | '';
  sort?: string;
  direction?: 'asc' | 'desc';
}

export function customerListQuery(state: CustomerListState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.page && state.page > 1) params.set('page', String(state.page));
  if (state.search) params.set('search', state.search);
  if (state.tag) params.set('tag', state.tag);
  if (state.segment) params.set('segment', state.segment);
  if (state.sort) params.set('sort', state.sort);
  if (state.direction) params.set('direction', state.direction);
  return params;
}

export function customerDetailHref(contactId: string, query: URLSearchParams | string): string {
  const serialized = typeof query === 'string' ? query.replace(/^\?/, '') : query.toString();
  return `/admin/customers/${encodeURIComponent(contactId)}${serialized ? `?${serialized}` : ''}`;
}

const SEGMENT_BADGE_CLASSES: Record<CustomerSegment, string> = {
  Prospect: 'bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-slate-300',
  New: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  Repeat: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  Lapsed: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
};

export function segmentBadgeClass(segment: CustomerSegment): string {
  return SEGMENT_BADGE_CLASSES[segment];
}
