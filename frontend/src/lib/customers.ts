export type CustomerSegment = 'Prospect' | 'New' | 'Repeat' | 'Lapsed';

export const CUSTOMER_SEGMENTS: readonly CustomerSegment[] = [
  'Prospect',
  'New',
  'Repeat',
  'Lapsed',
];

export function customerSegmentFrom(value: string | null | undefined): CustomerSegment | '' {
  if (!value) return '';
  return CUSTOMER_SEGMENTS.find((segment) => segment.toLowerCase() === value.toLowerCase()) || '';
}

export interface CustomerListState {
  page?: number;
  search?: string;
  tag?: string;
  segment?: CustomerSegment | '';
  rsvp?: 'going' | '';
  eventId?: string;
  sort?: string;
  direction?: 'asc' | 'desc';
}

export function customerListQuery(state: CustomerListState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.page && state.page > 1) params.set('page', String(state.page));
  if (state.search) params.set('search', state.search);
  if (state.tag) params.set('tag', state.tag);
  if (state.segment) params.set('segment', state.segment);
  if (state.rsvp) params.set('rsvp', state.rsvp);
  if (state.rsvp && state.eventId) params.set('eventId', state.eventId);
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

/** Timeline line for an RSVP; the party size is shown only when the guest brings others. */
export function rsvpTimelineText(eventName: string | null | undefined, partySize?: number | null): string {
  const party = partySize && partySize > 1 ? ` (party of ${partySize})` : '';
  return `RSVP'd to ${eventName || 'an event'}${party}`;
}

/** Account card note for a contact without an account: only a buyer "completed a purchase". */
export function guestAccountNote({ transactions, rsvps }: { transactions: number; rsvps: number }): string {
  if (transactions > 0) {
    return 'This customer does not have an account. They completed their purchase as a guest.';
  }
  if (rsvps > 0) return 'This contact does not have an account. They RSVP’d as a guest.';
  return 'This contact does not have an account.';
}
