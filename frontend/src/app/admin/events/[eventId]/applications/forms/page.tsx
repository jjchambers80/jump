'use client';

// Old Admin › Event › Applications › Forms link (spec 011). A form is set up
// in the registration flow (spec 057; a live event's goes back to the event).
import WizardRedirect from '@/components/event-setup/WizardRedirect';
import { formFlowHref } from '@/components/event-setup/formFlows';

export default function FormsPage({ params }: { params: { eventId: string } }) {
  const href = formFlowHref(params.eventId, 'registration');
  return <WizardRedirect to={() => href} fallback={href} />;
}
