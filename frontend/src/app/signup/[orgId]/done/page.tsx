'use client';

// /signup/[orgId]/done — finish onboarding (spec 022).
// Completes on the server (stamps the org, creates the Jump customer record,
// promotes the owner), forces the session's role/org claims to refresh, tells
// the tab that opened this one (org switcher) to reload its list, and lands
// on the new organization's dashboard.

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import signupService from '@/services/signupService';
import { ORG_CHANNEL, announceOrganizationCreated } from '@/lib/orgChannel';

export default function DoneStep() {
  const router = useRouter();
  const { orgId } = useParams<{ orgId: string }>();
  const { update } = useSession();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        const org = await signupService.complete(orgId);
        // The jwt callback re-reads role + memberships on trigger === 'update'
        await update();
        announceOrganizationCreated(org.id);
        router.replace(`/admin/dashboard?org=${encodeURIComponent(org.id)}`);
      } catch (err: any) {
        setError(err.message || 'Could not finish setting up your organization');
      }
    })();
  }, [orgId, router, update]);

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center text-white px-4"
      style={{ background: 'radial-gradient(ellipse at 50% 30%, #0f1f1c 0%, #070d0c 60%, #050807 100%)' }}
      data-testid="signup-done"
      data-channel={ORG_CHANNEL}
    >
      {error ? (
        <div className="max-w-md text-center">
          <p className="text-lg font-semibold">Something went wrong</p>
          <p className="mt-2 text-sm text-white/70">{error}</p>
          <button
            type="button"
            onClick={() => router.replace('/signup')}
            className="mt-6 rounded-full bg-white/10 hover:bg-white/20 px-5 py-2 text-sm font-medium"
          >
            Back to signup
          </button>
        </div>
      ) : (
        <>
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white" />
          <p className="mt-4 text-sm text-white/70">Setting up your organization…</p>
        </>
      )}
    </div>
  );
}
