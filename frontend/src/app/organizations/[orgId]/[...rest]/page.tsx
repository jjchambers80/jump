// Platform-host catch-all under an organization (spec 028): a path that no
// route serves is checked against the organization's URL redirects before
// the 404 renders. Relative targets are prefixed back onto /organizations/:id.

import { notFound, permanentRedirect } from 'next/navigation';
import { API_URL } from '@/lib/assets';
import { hostifyRedirectTarget } from '@/lib/storefrontHost';

export const dynamic = 'force-dynamic';

export default async function OrganizationCatchAll({
  params,
}: {
  params: { orgId: string; rest: string[] };
}) {
  const path = `/${params.rest.map((segment) => encodeURIComponent(decodeURIComponent(segment))).join('/')}`;
  let to: string | null = null;
  try {
    const res = await fetch(
      `${API_URL}/organizations/${encodeURIComponent(params.orgId)}/public/redirect?path=${encodeURIComponent(path)}`,
      { signal: AbortSignal.timeout(2000), cache: 'no-store' }
    );
    if (res.ok) to = ((await res.json()) as { to?: string }).to ?? null;
  } catch {
    to = null;
  }
  if (to) permanentRedirect(hostifyRedirectTarget(to, params.orgId, false));
  notFound();
}
