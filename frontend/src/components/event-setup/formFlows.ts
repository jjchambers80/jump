// Application setup flows (spec 051): each application type is its own task,
// walked one form at a time in the setup wizard's shell, out of the event
// wizard. `/admin/events/<id>/setup/<flow>?step=<key>&form=<id>`.
//
// Pure module: the registry, its links and the redirect of the event wizard's
// old application step keys (`setup?step=vendors&form=…`).

import type { FormPurpose } from '@/lib/applications';
import { isApplicationStep, stepForPurpose, type ApplicationStepKey } from './applicationSteps';

/** Spec 057: `registration` is a registration event's one form, set up inside its event wizard. */
export type FormFlowKey = ApplicationStepKey | 'registration';
export type FlowStepKey = 'lineup' | 'start' | 'details' | 'options' | 'payment' | 'floor-map' | 'questions' | 'review';

/** What a flow's steps need to know about its form (null before it is created). */
export interface FlowForm {
  kind: 'FREE' | 'PAID';
  spaceSelection?: string | null;
}

export interface FlowStep {
  key: FlowStepKey;
  title: string;
  intro: string;
  /** Needs the form row: unreachable until Start creates it. */
  needsForm: boolean;
  visible: (form: FlowForm | null) => boolean;
  /** Where the preview scrolls on the event page. */
  anchor: string;
  /** Steps that shape the form preview the form itself, scrolled to this id; null = the event page. */
  formAnchor: string | null;
  /** `space`: the preview shows the vendor's choose-and-pay screen instead of the apply form. */
  preview?: 'space';
}

const always = () => true;
const paid = (form: FlowForm | null) => !form || form.kind === 'PAID';
const onMap = (form: FlowForm | null) => !!form && form.spaceSelection === 'MAP';
/** Spec 057: a registration form starts free, so before it exists it counts as free. */
const paidForm = (form: FlowForm | null) => !!form && form.kind === 'PAID';

const s = (key: FlowStepKey, title: string, intro: string, rest: Partial<FlowStep> = {}): FlowStep => ({
  key, title, intro, needsForm: key !== 'start' && key !== 'lineup', visible: always, anchor: 'get-involved', formAnchor: null, ...rest,
});

const details = s('details', 'Form details', 'What applicants see first, and when the form takes applications.', { formAnchor: 'apply-top' });
const questions = s('questions', 'Fields', 'Email is always asked. Add any other fields you need.', { formAnchor: 'step-questions' });
const review = s('review', 'Review and open', 'Check the form, then decide when it takes applications.', { formAnchor: 'apply-top' });

export const FORM_FLOWS: Record<FormFlowKey, { title: string; steps: FlowStep[] }> = {
  vendors: {
    title: 'Vendor application',
    steps: [
      s('start', 'Start a vendor application', 'Vendors apply for a space. You review each one, then they choose a space and pay.', { formAnchor: 'apply-top' }),
      details,
      s('options', 'Options and pricing', 'What vendors can be approved for: a price and a number of spots for each.', { visible: paid, formAnchor: 'apply-summary', preview: 'space' }),
      s('payment', 'How vendors choose and pay', 'Vendors apply for free. Once you approve them, they choose a space and pay.', { visible: paid, formAnchor: 'apply-summary', preview: 'space' }),
      s('floor-map', 'Floor map', 'Vendors pick their spot on this map.', { visible: onMap, anchor: 'floor-map' }),
      questions,
      review,
    ],
  },
  'special-guests': {
    title: 'Special guests',
    steps: [
      s('lineup', 'Special guest lineup', 'Add the guests you have booked. The lineup shows on the event page.', { anchor: 'guests' }),
      s('start', 'Application form', 'Optional. Let artists, creators and celebrities apply to appear.', { anchor: 'guests', formAnchor: 'apply-top' }),
      { ...details, anchor: 'guests' },
      { ...questions, anchor: 'guests' },
      { ...review, anchor: 'guests' },
    ],
  },
  volunteers: {
    title: 'Volunteer application',
    steps: [
      s('start', 'Start a volunteer application', 'People sign up to help run your event.', { formAnchor: 'apply-top' }),
      details,
      questions,
      review,
    ],
  },
  'other-applications': {
    title: 'Application',
    steps: [s('start', 'Start an application', 'Sponsors, press, panels and anything else people apply for.', { formAnchor: 'apply-top' }), details, questions, review],
  },
  // Spec 057: between the event's Image and Collect more steps; the event wizard's Review publishes.
  registration: {
    title: 'Registration form',
    steps: [
      s('start', 'Who registers?', 'Vendors, sponsors, volunteers or anyone you choose. Decide if they pay.', { formAnchor: 'apply-top' }),
      details,
      s('options', 'Options and pricing', 'What registrants can be approved for: a price and a number of spots for each.', { visible: paidForm, formAnchor: 'apply-summary', preview: 'space' }),
      s('payment', 'How registrants choose and pay', 'Registration is free. Once you approve someone, they choose and pay.', { visible: paidForm, formAnchor: 'apply-summary', preview: 'space' }),
      s('floor-map', 'Floor map', 'Registrants pick their spot on the floor map of the event this is for.', { visible: onMap, anchor: 'floor-map' }),
      questions,
    ],
  },
};

export const isFormFlow = (key: string): key is FormFlowKey => key === 'registration' || isApplicationStep(key);

/**
 * `maps: false` (Maps off or hidden for the role) drops the floor-map step, and so does
 * `mapEvent: false`: a registration event not linked to a live event has no map to sell.
 */
export const flowSteps = (flow: FormFlowKey, form: FlowForm | null, { maps = true, mapEvent = true } = {}) =>
  FORM_FLOWS[flow].steps.filter((step) => step.visible(form) && ((maps && mapEvent) || step.key !== 'floor-map'));

/** `/admin/events/<id>/setup/<flow>?step=&form=&org=`. */
export function formFlowHref(
  eventId: string,
  flow: FormFlowKey,
  { form, step, org }: { form?: string | null; step?: FlowStepKey; org?: string | null } = {}
): string {
  const query = new URLSearchParams();
  if (step) query.set('step', step);
  if (form) query.set('form', form);
  if (org) query.set('org', org);
  const q = query.toString();
  return `/admin/events/${encodeURIComponent(eventId)}/setup/${flow}${q ? `?${q}` : ''}`;
}

/** The flow that edits a form, at Form details. A registration event's form is its `registration` flow (spec 057). */
export const formEditHref = (
  eventId: string,
  form: { id: string; purpose?: FormPurpose | null },
  org?: string | null,
  eventType?: 'LIVE' | 'REGISTRATION'
) => formFlowHref(eventId, eventType === 'REGISTRATION' ? 'registration' : stepForPurpose(form.purpose), { form: form.id, step: 'details', org });

/**
 * The event wizard's old application step keys (spec 050), still in emails,
 * bookmarks and readiness items: where they live now. Null for any other key.
 * `floor-map` needs a vendor form on a map; without one it opens a new vendor form.
 */
export function legacyFlowHref(
  eventId: string,
  step: string | null,
  formId: string | null,
  forms: { id: string; purpose?: FormPurpose | null; kind?: string; spaceSelection?: string | null }[],
  org?: string | null
): string | null {
  if (step === 'floor-map') {
    const map = forms.find((f) => f.id === formId) ?? forms.find((f) => f.purpose === 'VENDOR' && f.spaceSelection === 'MAP');
    return formFlowHref(eventId, 'vendors', map ? { form: map.id, step: 'floor-map', org } : { org });
  }
  if (!step || !isFormFlow(step)) return null;
  const form = forms.find((f) => f.id === formId);
  if (form) return formEditHref(eventId, form, org);
  return formFlowHref(eventId, step, { org, step: step === 'special-guests' ? 'lineup' : undefined });
}
