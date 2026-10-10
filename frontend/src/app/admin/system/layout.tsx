'use client';

// System administration guard. src/middleware.ts already turns away anyone
// whose session cookie is not SYSTEM_ADMIN; this is the client-side second
// layer (and covers a role change picked up by the 60 s claims refresh).
// Nothing renders until the session says SYSTEM_ADMIN.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';

export default function SystemLayout({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const isSystemAdmin = (session?.user as { role?: string } | undefined)?.role === 'SYSTEM_ADMIN';
  // AdminRoute already handles signed-out sessions; only a settled, signed-in
  // non-system-admin is sent away.
  const denied = status === 'authenticated' && !isSystemAdmin;

  useEffect(() => {
    if (denied) router.replace('/admin/dashboard');
  }, [denied, router]);

  return isSystemAdmin ? <>{children}</> : null;
}
