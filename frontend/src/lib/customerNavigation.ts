export type CustomerScope = 'customers' | 'all';

type SearchParamsLike = Pick<URLSearchParams, 'get' | 'toString'>;

export function customerScopeFrom(params: Pick<URLSearchParams, 'get'>): CustomerScope {
  return params.get('scope') === 'all' ? 'all' : 'customers';
}

export function withCustomerScope(
  params: SearchParamsLike,
  scope: CustomerScope
): URLSearchParams {
  const next = new URLSearchParams(params.toString());
  next.set('scope', scope);
  return next;
}

function hrefWithParams(path: string, params: SearchParamsLike): string {
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

export function customerDetailHref(
  contactId: string,
  params: SearchParamsLike
): string {
  return hrefWithParams(`/admin/customers/${encodeURIComponent(contactId)}`, params);
}

export function customerListHref(params: SearchParamsLike): string {
  return hrefWithParams('/admin/customers', params);
}
