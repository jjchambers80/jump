'use client';

// State of one application flow visit (spec 051): the event, its forms, the
// form this run edits (`?form=`), the visible steps and the current one
// (`?step=`). A step that needs the form is unreachable until Start creates
// it; anything invalid is replaced in the URL, so Back and reloads work.

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCan, useOrg } from '@/components/OrgContext';
import { flowSteps, formFlowHref, type FlowStep, type FlowStepKey, type FormFlowKey } from './formFlows';
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
  // Spec 057: a registration event has one form, its `registration` flow; a live event keeps its lineup.
  const registration = event?.type === 'REGISTRATION';
  const formId = params.get('form') ?? (registration ? forms.forms[0]?.id ?? null : null);
  const form = (formId && forms.forms.find((f) => f.id === formId)) || null;
  const list = flowSteps(flow, form, { maps, mapEvent: flow !== 'registration' || !!event?.linkedEventId });
  const reachable = (step: FlowStep) => !step.needsForm || !!form;
  const requested = list.find((step) => step.key === params.get('step'));
  // The first step this form can open: Fields, or Start while the form does not exist yet.
  const fallback = list.find(reachable) ?? list[0];
  const step = requested && reachable(requested) ? requested : fallback;
  const at = list.indexOf(step);
  const ready = data.load.status === 'ready' && forms.load.status === 'ready';
  // The wrong flow for the event's type: its own flow (a live event has no `registration` flow).
  const wrongFlow = ready && !!event && (registration ? flow !== 'registration' : flow === 'registration');

  const href = (key: FlowStepKey, id: string | null = form?.id ?? null) => formFlowHref(eventId, flow, { form: id, step: key, org });

  // Put the resolved step (and a form that exists) in the URL.
  const target = !ready
    ? null
    : wrongFlow
      ? registration
        ? formFlowHref(eventId, 'registration', { form: form?.id, org })
        : `/admin/events/${encodeURIComponent(eventId)}`
      : registration && form && !params.get('form')
        ? // The registration's one form exists: its Start is done (Create lands here too), so the step asked for or the flow from the top.
          href(step.key === 'start' ? list[0].key : step.key)
        : step !== requested || (formId && !form)
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
    toEventStep: (key: 'image' | 'collect-more' | 'review') => router.push(`/admin/events/${encodeURIComponent(eventId)}/setup?step=${key}${org ? `&org=${encodeURIComponent(org)}` : ''}`),
    revision,
    /** After any save: the preview frame reloads the event. */
    refreshPreview: () => setRevision((r) => r + 1),
  };
}

export type FormFlow = ReturnType<typeof useFormFlow>;
