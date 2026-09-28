'use client';

// Spike 038-0 (§9a.1 Clearing): a Server Component cannot delete cookies in
// Next 14, so the gate mounts this island to expire a stale access cookie.
import { useEffect } from 'react';

export default function ClearAccessCookie({ orgId }: { orgId: string }) {
  useEffect(() => {
    void fetch(`/api/storefront/access/${encodeURIComponent(orgId)}`, { method: 'DELETE' });
  }, [orgId]);
  return null;
}
