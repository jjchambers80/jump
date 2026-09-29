'use client';

// Store password gate on server-rendered themed pages (contracts C2). Unlocks
// through the route handler (sets the httpOnly cookie the server reads),
// keeps writing localStorage for the client-rendered pages that remain
// (checkout, account), then re-renders on the server. A forwarded cookie that
// was refused is expired first, so a stale token never lingers.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import StorefrontPasswordGate from '@/components/StorefrontPasswordGate';
import type { StorefrontLockInfo } from './types';

export default function ThemedPasswordGate({ lock, clearCookie }: { lock: StorefrontLockInfo; clearCookie: boolean }) {
  const router = useRouter();
  const orgId = lock.organization.id;

  useEffect(() => {
    if (clearCookie) void fetch(`/api/storefront/access/${encodeURIComponent(orgId)}`, { method: 'DELETE' });
  }, [clearCookie, orgId]);

  return (
    <StorefrontPasswordGate
      organization={lock.organization}
      message={lock.message}
      exchange={async (password) => {
        const res = await fetch(`/api/storefront/access/${encodeURIComponent(orgId)}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ password }),
        });
        const body = (await res.json().catch(() => ({}))) as { token?: string; message?: string };
        if (!res.ok || !body.token) throw Object.assign(new Error(body.message ?? 'Incorrect password'), { status: res.status });
        return body.token;
      }}
      onUnlocked={() => router.refresh()}
    />
  );
}
