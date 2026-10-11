'use client';

// Old Admin › Event › Applications › Form editor link (spec 011). Since spec
// 050-P a form is edited inline on the wizard step of its purpose (`&form=`
// expands it). If the lookup fails, the vendors step opens; its `&form=`
// handling moves to the right step once forms load.
import type { AdminForm } from '@/lib/applications';
import api from '@/services/api';
import WizardRedirect from '@/components/event-setup/WizardRedirect';
import { stepForPurpose } from '@/components/event-setup/applicationSteps';
import { wizardStepHref } from '@/lib/eventWizard';

export default function FormEditorPage({ params }: { params: { eventId: string; formId: string } }) {
  const { eventId, formId } = params;
  return (
    <WizardRedirect
      to={async () => {
        const form = await api.get<AdminForm>(`/admin/events/${eventId}/application-forms/${formId}`);
        return wizardStepHref(eventId, stepForPurpose(form.purpose), { form: formId });
      }}
      fallback={wizardStepHref(eventId, 'vendors', { form: formId })}
    />
  );
}
