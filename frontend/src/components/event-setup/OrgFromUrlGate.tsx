'use client';

// Spec 050-O: the wizard mounts only once `?org=` (from Details or a redirect)
// is the selected organization, so its first requests go to the right org.

import { useSearchParams } from 'next/navigation';
import { useOrgFromUrl } from '@/lib/useOrgFromUrl';
import LoadingFields from './LoadingFields';

export default function OrgFromUrlGate({ children }: { children: React.ReactNode }) {
  const { pending } = useOrgFromUrl(useSearchParams().get('org'));
  return pending ? <LoadingFields /> : <>{children}</>;
}
