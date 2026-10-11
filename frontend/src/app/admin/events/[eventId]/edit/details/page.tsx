'use client';

// Event › Edit details (spec 037 phase 3). With the wizard flag on (spec
// 050-O) the wizard owns these fields: the section hash picks its step.
import { useParams } from 'next/navigation';
import EventEditor from '../EventEditor';
import WizardRedirect from '@/components/event-setup/WizardRedirect';
import { EVENT_WIZARD_ENABLED, legacyEditStep, wizardStepHref } from '@/lib/eventWizard';

export default function EditEventDetailsPage() {
  const eventId = useParams().eventId as string;
  if (!EVENT_WIZARD_ENABLED) return <EventEditor scope="details" />;
  return (
    <WizardRedirect
      to={() => wizardStepHref(eventId, legacyEditStep('details', window.location.hash))}
      fallback={wizardStepHref(eventId, legacyEditStep('details', ''))}
    />
  );
}
