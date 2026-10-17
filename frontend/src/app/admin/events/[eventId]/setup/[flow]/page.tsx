'use client';

// A setup flow on an event (spec 051): `/setup/registration` (spec 057) or
// `/setup/special-guests` (the lineup), `?step=&form=`. The per-type flows from
// before forms lost their type (`/setup/vendors`, …) redirect to the registration flow.

import { Suspense } from 'react';
import { notFound, redirect } from 'next/navigation';
import FormFlowPage from '@/components/event-setup/FormFlowPage';
import OrgFromUrlGate from '@/components/event-setup/OrgFromUrlGate';
import { LEGACY_FLOWS, isFormFlow } from '@/components/event-setup/formFlows';

export default function FormFlowRoute({ params, searchParams }: { params: { eventId: string; flow: string }; searchParams: Record<string, string> }) {
  if (LEGACY_FLOWS.has(params.flow)) {
    const query = new URLSearchParams(searchParams).toString();
    redirect(`/admin/events/${encodeURIComponent(params.eventId)}/setup/registration${query ? `?${query}` : ''}`);
  }
  if (!isFormFlow(params.flow)) notFound();
  return (
    <Suspense fallback={null}>
      <OrgFromUrlGate>
        <FormFlowPage eventId={params.eventId} flow={params.flow} />
      </OrgFromUrlGate>
    </Suspense>
  );
}
