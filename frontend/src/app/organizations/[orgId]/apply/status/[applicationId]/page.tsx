// Spec 044D: a standing-form applicant's status page (link from the received email).

import { Suspense } from 'react';
import StandingStatusView from './StandingStatusView';

export default function StandingStatusPage({ params }: { params: { orgId: string; applicationId: string } }) {
  return (
    <Suspense fallback={null}>
      <StandingStatusView orgId={params.orgId} applicationId={params.applicationId} />
    </Suspense>
  );
}
