'use client';

// Requires a staff session for the signup flow; sends signed-out visitors to
// sign-in and back to the step they were on.

import { usePathname } from 'next/navigation';
import ProtectedRoute from '@/components/ProtectedRoute';

export default function SignupGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '/signup';
  return (
    <ProtectedRoute fallbackUrl={`/auth/signin?callbackUrl=${encodeURIComponent(pathname)}`}>
      {children}
    </ProtectedRoute>
  );
}
