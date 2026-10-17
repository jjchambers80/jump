'use client';

// State of one application flow visit (spec 051): the event, its forms, the
// form this run edits (`?form=`), the visible steps and the current one
// (`?step=`). A step that needs the form is unreachable until Start creates
// it; anything invalid is replaced in the URL, so Back and reloads work.
// An event has one live form per purpose: Start on a single-purpose flow that
// already has one opens that form instead.

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCan, useOrg } from '@/components/OrgContext';
import { APPLICATION_STEPS, formsOnStep, stepForPurpose } from './applicationSteps';
import { flowSteps, formEditHref, formFlowHref, type FlowStep, type FlowStepKey, type FormFlowKey } from './formFlows';
import { useSetupData } from './useSetupData';
import { useSetupForms } from './useSetupForms';

export function useFormFlow(eventId: string, flow: FormFlowKey) {
  const router = useRouter();
  const params = useSearchParams();
  const { selectedOrgId: orgId, loading: orgLoading } = useOrg();
  const maps = useCan('maps');
  const data = useSetupData(orgId, orgLoading, eventId);
  const forms = useSetupForms(eventId);
  const [revision, setRevision] = useState(0);

  const org = params.get('org');
  const event = data.saved;
  // Spec 057: a registration event has one form, its `registration` flow; a live event keeps the four flows.
  const registration = event?.type === 'REGISTRATION';
  const formId = params.get('form') ?? (registration ? forms.forms[0]?.id ?? null : null);
  const form = (formId && forms.forms.find((f) => f.id === formId)) || null;
  const list = flowSteps(flow, form, { maps, mapEvent: flow !== 'registration' || !!event?.linkedEventId });
  const reachable = (step: FlowStep) => !step.needsForm || !!form;
  const requested = list.find((step) => step.key === params.get('step'));
  const fallback = form ? list.find((step) => step.key === 'details')! : list[0];
  const step = requested && reachable(requested) ? requested : fallback;
  const at = list.indexOf(step);
  const ready = data.load.status === 'ready' && forms.load.status === 'ready';
  const live =
    flow !== 'registration' && !form && step.key === 'start' && APPLICATION_STEPS[flow].purposes.length === 1
      ? formsOnStep(flow, forms.forms).find((f) => f.status !== 'CLOSED') ?? null
      : null;
  // The wrong flow for the event's type: its own flow (a live event has no `registration` flow).
  const wrongFlow = ready && !!event && (registration ? flow !== 'registration' : flow === 'registration');

  const href = (key: FlowStepKey, id: string | null = form?.id ?? null) => formFlowHref(eventId, flow, { form: id, step: key, org });

  // Put the resolved step (and a form that exists) in the URL; a form of another type opens its own flow.
  const target = !ready
    ? null
    : wrongFlow
      ? registration
        ? formFlowHref(eventId, 'registration', { form: form?.id, step: form ? 'details' : undefined, org })
        : `/admin/events/${encodeURIComponent(eventId)}`
      : live
        ? formEditHref(eventId, live, org)
        : form && !registration && stepForPurpose(form.purpose) !== flow
          ? formEditHref(eventId, form, org)
          : step !== requested || (formId && !form) || (registration && form && !params.get('form'))
            ? href(step.key)
            : null;
  useEffect(() => {
    if (target) router.replace(target);
  }, [target, router]);

  return {
    orgId,
    data,
    event,
    registration,
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
    /** Spec 057: back into the registration event's own wizard (Image before the flow, Collect more after it). */
    toEventStep: (key: 'image' | 'collect-more') => router.push(`/admin/events/${encodeURIComponent(eventId)}/setup?step=${key}${org ? `&org=${encodeURIComponent(org)}` : ''}`),
    revision,
    /** After any save: the preview frame reloads the event. */
    refreshPreview: () => setRevision((r) => r + 1),
  };
}

export type FormFlow = ReturnType<typeof useFormFlow>;
