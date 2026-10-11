'use client';

// /admin/events/:id/edit predates the section editors (spec 037 phase 3).
// Old links carry a section hash; send each to the editor that owns it,
// keeping the query (orgId, imageUpload) and the hash. With the wizard flag
// on (spec 050-O) the hash picks the wizard step instead.

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import WizardRedirect from '@/components/event-setup/WizardRedirect';
import { EVENT_WIZARD_ENABLED, legacyEditStep, wizardStepHref } from '@/lib/eventWizard';

const SALES_SECTIONS = new Set(['event-admission', 'event-price-tiers', 'event-add-ons']);

function EditorRedirect() {
  const router = useRouter();
  const params = useParams();
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    const target = SALES_SECTIONS.has(hash) ? 'sales' : 'details';
    router.replace(`/admin/events/${params.eventId}/edit/${target}${window.location.search}${window.location.hash}`);
  }, [router, params.eventId]);
  return null;
}

export default function EditEventRedirect() {
  const params = useParams();
  const eventId = params.eventId as string;
  if (!EVENT_WIZARD_ENABLED) return <EditorRedirect />;
  return <WizardRedirect to={() => wizardStepHref(eventId, legacyEditStep(null, window.location.hash))} fallback={wizardStepHref(eventId, 'name')} />;
}
