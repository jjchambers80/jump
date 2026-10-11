'use client';

// An application flow on an event (spec 051): `/setup/vendors`, `/setup/special-guests`,
// `/setup/volunteers` or `/setup/other-applications`, `?step=&form=`.

import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import FormFlowPage from '@/components/event-setup/FormFlowPage';
import OrgFromUrlGate from '@/components/event-setup/OrgFromUrlGate';
import { isFormFlow } from '@/components/event-setup/formFlows';

export default function FormFlowRoute({ params }: { params: { eventId: string; flow: string } }) {
  if (!isFormFlow(params.flow)) notFound();
  return (
    <Suspense fallback={null}>
      <OrgFromUrlGate>
        <FormFlowPage eventId={params.eventId} flow={params.flow} />
      </OrgFromUrlGate>
    </Suspense>
  );
}
