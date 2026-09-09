// Admin Route wrapper
// Requires ADMIN or ORGANIZER role, shows 403 for unauthorized users (T001, T020)

'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';

interface AdminRouteProps {
  children: React.ReactNode;
}

const ALLOWED_ROLES = ['ADMIN', 'ORGANIZER', 'SYSTEM_ADMIN'];

export default function AdminRoute({ children }: AdminRouteProps) {
  const { data: session, status } = useSession();
  const loading = status === 'loading';
  const isAuthenticated = status === 'authenticated';
  const userRole = (session?.user as any)?.role;
  const isAllowed = ALLOWED_ROLES.includes(userRole);
  const router = useRouter();

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.push('/auth/signin');
    }
  }, [loading, isAuthenticated, router]);

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

  if (!isAllowed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-slate-900">
        <div className="max-w-md w-full bg-white dark:bg-slate-800 rounded-lg shadow-md p-8 text-center">
          <div className="text-6xl mb-4">🚫</div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Access Denied</h1>
          <p className="text-gray-600 dark:text-slate-400 mb-6">
            You don&apos;t have permission to access this page. Admin or Organizer role is required.
          </p>
          <button
            onClick={() => router.push('/events')}
            className="bg-indigo-600 text-white px-6 py-2 rounded-md hover:bg-indigo-700 transition-colors"
          >
            Back to Events
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
