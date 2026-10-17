'use client';

// Old Admin › Event › Applications › Form editor link (spec 011). A form is
// edited in the registration flow (spec 057; a live event's goes back to the event).
import WizardRedirect from '@/components/event-setup/WizardRedirect';
import { formEditHref } from '@/components/event-setup/formFlows';

export default function FormEditorPage({ params }: { params: { eventId: string; formId: string } }) {
  const href = formEditHref(params.eventId, { id: params.formId });
  return <WizardRedirect to={() => href} fallback={href} />;
}
