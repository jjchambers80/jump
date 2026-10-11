'use client';

// Old Admin › Event › Applications › Form editor link (spec 011). A form is
// edited in the application flow of its purpose (spec 051). If the lookup
// fails, the old wizard link opens; it finds the form's flow once forms load.
import type { AdminForm } from '@/lib/applications';
import api from '@/services/api';
import WizardRedirect from '@/components/event-setup/WizardRedirect';
import { wizardStepHref } from '@/lib/eventWizard';
import { formEditHref } from '@/components/event-setup/formFlows';

export default function FormEditorPage({ params }: { params: { eventId: string; formId: string } }) {
  const { eventId, formId } = params;
  return (
    <WizardRedirect
      to={async () => {
        const form = await api.get<AdminForm>(`/admin/events/${eventId}/application-forms/${formId}`);
        return formEditHref(eventId, form);
      }}
      fallback={wizardStepHref(eventId, 'vendors', { form: formId })}
    />
  );
}
