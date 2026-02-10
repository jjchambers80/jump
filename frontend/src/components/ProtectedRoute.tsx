// Protected Route wrapper
// Requires authentication, redirects to sign-in if not authenticated (T108, updated T096)

'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';

interface ProtectedRouteProps {
  children: React.ReactNode;
  fallbackUrl?: string;
}

export default function ProtectedRoute({
  children,
  fallbackUrl = '/auth/signin',
}: ProtectedRouteProps) {
  const { status } = useSession();
  const loading = status === 'loading';
  const isAuthenticated = status === 'authenticated';
  const router = useRouter();

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.push(fallbackUrl);
    }
  }, [loading, isAuthenticated, router, fallbackUrl]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return <>{children}</>;
}
