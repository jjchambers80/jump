'use client';

// Old Admin › Event › Applications › Forms link (spec 011). Since spec 050-P
// forms are configured in the setup wizard's application steps; send old
// links to the first of them.
import WizardRedirect from '@/components/event-setup/WizardRedirect';
import { wizardStepHref } from '@/lib/eventWizard';

export default function FormsPage({ params }: { params: { eventId: string } }) {
  const href = wizardStepHref(params.eventId, 'vendors');
  return <WizardRedirect to={() => href} fallback={href} />;
}
