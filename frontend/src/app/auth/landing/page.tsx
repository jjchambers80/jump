// Fallback only: src/middleware.ts answers /auth/landing with a role-based
// redirect before this renders.
import { redirect } from 'next/navigation';

export default function SignInLanding() {
  redirect('/events');
}
