'use client';

// /signup/[orgId]/subscribe — phase 2 (Stripe Billing, BILLING_ENABLED).
// Until then the backend never resumes at this step; anyone landing here is
// moved on to the survey.

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

export default function SubscribeStep() {
  const router = useRouter();
  const { orgId } = useParams<{ orgId: string }>();

  useEffect(() => {
    router.replace(`/signup/${orgId}/survey`);
  }, [orgId, router]);

  return null;
}
