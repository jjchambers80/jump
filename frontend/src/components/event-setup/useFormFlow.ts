'use client';

// State of one application flow visit (spec 051): the event, its forms, the
// form this run edits (`?form=`), the visible steps and the current one
// (`?step=`). A step that needs the form is unreachable until Start creates
// it; anything invalid is replaced in the URL, so Back and reloads work.

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useOrg } from '@/components/OrgContext';
import { stepForPurpose } from './applicationSteps';
import { flowSteps, formEditHref, formFlowHref, type FlowStep, type FlowStepKey, type FormFlowKey } from './formFlows';
import { useSetupData } from './useSetupData';
import { useSetupForms } from './useSetupForms';

export function useFormFlow(eventId: string, flow: FormFlowKey) {
  const router = useRouter();
  const params = useSearchParams();
  const { selectedOrgId: orgId, loading: orgLoading } = useOrg();
  const data = useSetupData(orgId, orgLoading, eventId);
  const forms = useSetupForms(eventId);
  const [revision, setRevision] = useState(0);

  const org = params.get('org');
  const formId = params.get('form');
  const form = (formId && forms.forms.find((f) => f.id === formId)) || null;
  const list = flowSteps(flow, form);
  const reachable = (step: FlowStep) => !step.needsForm || !!form;
  const requested = list.find((step) => step.key === params.get('step'));
  const fallback = form ? list.find((step) => step.key === 'details')! : list[0];
  const step = requested && reachable(requested) ? requested : fallback;
  const at = list.indexOf(step);
  const ready = data.load.status === 'ready' && forms.load.status === 'ready';

  const href = (key: FlowStepKey, id: string | null = form?.id ?? null) => formFlowHref(eventId, flow, { form: id, step: key, org });

  // Put the resolved step (and a form that exists) in the URL; a form of another type opens its own flow.
  const target = !ready
    ? null
    : form && stepForPurpose(form.purpose) !== flow
      ? formEditHref(eventId, form, org)
      : step !== requested || (formId && !form)
        ? href(step.key)
        : null;
  useEffect(() => {
    if (target) router.replace(target);
  }, [target, router]);

  return {
    orgId,
    data,
    event: data.saved,
    forms,
    form,
    list,
    step,
    at,
    ready,
    redirecting: !!target,
    href,
    go: (key: FlowStepKey, id?: string) => router.push(href(key, id)),
    exit: (saved = false) => router.push(`/admin/events/${encodeURIComponent(eventId)}${saved ? '?saved=1' : ''}`),
    revision,
    /** After any save: the preview frame reloads the event. */
    refreshPreview: () => setRevision((r) => r + 1),
  };
}

export type FormFlow = ReturnType<typeof useFormFlow>;
