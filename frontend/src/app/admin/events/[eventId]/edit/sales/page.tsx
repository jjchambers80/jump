'use client';

// Old Event › Edit sales link (spec 037 phase 3). The setup wizard owns these
// fields since spec 050-P: the section hash picks its step.
import { useParams } from 'next/navigation';
import WizardRedirect from '@/components/event-setup/WizardRedirect';
import { legacyEditStep, wizardStepHref } from '@/lib/eventWizard';

export default function EditEventSalesPage() {
  const eventId = useParams().eventId as string;
  return (
    <WizardRedirect
      to={() => wizardStepHref(eventId, legacyEditStep('sales', window.location.hash))}
      fallback={wizardStepHref(eventId, legacyEditStep('sales', ''))}
    />
  );
}
