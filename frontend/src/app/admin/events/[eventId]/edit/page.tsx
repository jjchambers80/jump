'use client';

// /admin/events/:id/edit, /edit/details and /edit/sales were the event editor
// until spec 050-P. The setup wizard owns every field now; old links carry a
// section hash, which picks the wizard step.

import { useParams } from 'next/navigation';
import WizardRedirect from '@/components/event-setup/WizardRedirect';
import { legacyEditStep, wizardStepHref } from '@/lib/eventWizard';

export default function EditEventRedirect() {
  const eventId = useParams().eventId as string;
  return <WizardRedirect to={() => wizardStepHref(eventId, legacyEditStep(null, window.location.hash))} fallback={wizardStepHref(eventId, 'name')} />;
}
