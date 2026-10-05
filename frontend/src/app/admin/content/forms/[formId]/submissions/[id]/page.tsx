// Content › Forms › Submission (spec 044): the shared application detail, on a standing form.
'use client';

import ApplicationDetail from '@/components/applications/ApplicationDetail';

export default function StandingSubmissionPage({ params }: { params: { formId: string; id: string } }) {
  return <ApplicationDetail standingFormId={params.formId} applicationId={params.id} />;
}
