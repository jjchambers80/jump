// Signup / onboarding layout (spec 022).
// Lives outside /admin: no sidebar, no OrgProvider, and UNASSIGNED users
// (who cannot enter /admin) are exactly who it is for. The edge middleware
// leaves non-admin paths alone; SignupGuard requires a session client-side.

import SignupGuard from './SignupGuard';

export const metadata = {
  title: 'Create your organization | Jump',
};

export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return <SignupGuard>{children}</SignupGuard>;
}
