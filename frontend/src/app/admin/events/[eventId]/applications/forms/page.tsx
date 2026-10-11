'use client';

// Old Admin › Event › Applications › Forms link (spec 011). Forms are set up
// in their application flows (spec 051); send old links to the vendor one.
import WizardRedirect from '@/components/event-setup/WizardRedirect';
import { formFlowHref } from '@/components/event-setup/formFlows';

export default function FormsPage({ params }: { params: { eventId: string } }) {
  const href = formFlowHref(params.eventId, 'vendors');
  return <WizardRedirect to={() => href} fallback={href} />;
}
