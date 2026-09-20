// Buyer session for storefront components (spec 031). One fetch of
// /api/buyer/me per mount; a session for another organization counts as
// signed out here (one cookie on the shared Jump domain — same rule as the
// account page). No polling: the header only needs "Sign in" vs "Account".
'use client';

import { useEffect, useState } from 'react';

export interface BuyerSummary {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  organization: { id: string; name: string };
}

export function useBuyer(orgId: string | null | undefined) {
  const [buyer, setBuyer] = useState<BuyerSummary | null>(null);
  const [loading, setLoading] = useState(Boolean(orgId));

  useEffect(() => {
    if (!orgId) {
      setBuyer(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch('/api/buyer/me', { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) return null;
        const data: BuyerSummary = await res.json();
        return data.organization?.id === orgId ? data : null;
      })
      .catch(() => null)
      .then((result) => {
        if (cancelled) return;
        setBuyer(result);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  return { buyer, loading };
}
