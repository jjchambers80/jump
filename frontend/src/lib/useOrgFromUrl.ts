'use client';

// `?org=<id>` on a page opened from a link (spec 050-O: Details → wizard, the
// old editors' redirects): select that organization when the viewer is a member
// and it is not already selected, so a user in two orgs lands on the right
// event. OrgContext reads `?org=` only on a full load; this covers in-app
// navigation. `pending` is true until the selection matches.

import { useEffect } from 'react';
import { useOrg } from '@/components/OrgContext';

export function useOrgFromUrl(requested: string | null | undefined) {
  const { organizations, selectedOrgId, setSelectedOrgId, loading } = useOrg();
  const switching = !!requested && requested !== selectedOrgId && organizations.some((o) => o.id === requested);
  useEffect(() => {
    if (!loading && switching && requested) setSelectedOrgId(requested);
  }, [loading, switching, requested, setSelectedOrgId]);
  return { pending: loading || switching };
}
