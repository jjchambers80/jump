export type CustomerSource = 'tickets' | 'rsvp' | 'subscribed' | 'form';

export const CUSTOMER_SOURCES: readonly CustomerSource[] = [
  'tickets',
  'rsvp',
  'subscribed',
  'form',
];

/** Contacts lists everyone by default; `scope=customers` narrows it to contacts with a paid order. */
export type CustomerScope = 'customers' | 'all';

export function customerScopeFrom(value: string | null | undefined): CustomerScope {
  return value === 'customers' ? 'customers' : 'all';
}

export function customerSourceFrom(value: string | null | undefined): CustomerSource | '' {
  if (!value) return '';
  return CUSTOMER_SOURCES.find((source) => source.toLowerCase() === value.toLowerCase()) || '';
}

export interface CustomerListState {
  page?: number;
  search?: string;
  tag?: string;
  scope?: CustomerScope;
  /** Spec 055: one list's contacts (built-in or saved list id) */
  list?: string;
  rsvp?: 'going' | '';
  eventId?: string;
  source?: CustomerSource | '';
  formId?: string;
  sort?: string;
  direction?: 'asc' | 'desc';
}

export function customerListQuery(state: CustomerListState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.page && state.page > 1) params.set('page', String(state.page));
  if (state.search) params.set('search', state.search);
  if (state.tag) params.set('tag', state.tag);
  if (state.scope === 'customers') params.set('scope', 'customers');
  if (state.list) params.set('list', state.list);
  if (state.rsvp) params.set('rsvp', state.rsvp);
  if (state.rsvp && state.eventId) params.set('eventId', state.eventId);
  if (state.source) params.set('source', state.source);
  if (state.formId) params.set('formId', state.formId);
  if (state.sort) params.set('sort', state.sort);
  if (state.direction) params.set('direction', state.direction);
  return params;
}

export function customerDetailHref(contactId: string, query: URLSearchParams | string): string {
  const serialized = typeof query === 'string' ? query.replace(/^\?/, '') : query.toString();
  return `/admin/contacts/${encodeURIComponent(contactId)}${serialized ? `?${serialized}` : ''}`;
}

/**
 * The detail API pages through the same list as the Contacts page. The backend
 * defaults to paying contacts, so the list scope is always sent explicitly.
 */
export function customerApiQuery(listQuery: string): string {
  const params = new URLSearchParams(listQuery);
  params.set('scope', customerScopeFrom(params.get('scope')));
  return params.toString();
}

/** Timeline line for an RSVP; the party size is shown only when the guest brings others. */
export function rsvpTimelineText(eventName: string | null | undefined, partySize?: number | null): string {
  const party = partySize && partySize > 1 ? ` (party of ${partySize})` : '';
  return `RSVP'd to ${eventName || 'an event'}${party}`;
}

/** Account card note for a contact without an account: only a buyer "completed a purchase". */
export function guestAccountNote({ transactions, rsvps }: { transactions: number; rsvps: number }): string {
  if (transactions > 0) {
    return 'This contact does not have an account. They completed their purchase as a guest.';
  }
  if (rsvps > 0) return 'This contact does not have an account. They RSVP’d as a guest.';
  return 'This contact does not have an account.';
}
