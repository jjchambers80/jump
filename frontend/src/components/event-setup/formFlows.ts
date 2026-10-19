// Setup flows in the setup wizard's shell (spec 051):
// `/admin/events/<id>/setup/<flow>?step=<key>&form=<id>`. Two are left:
// `registration`, a registration event's one form (spec 057), and
// `special-guests`, a live event's lineup. Forms have no type, so the per-type
// flows (vendors, volunteers, other applications) are gone; their old links
// open the registration flow.
//
// Pure module: the registry, its links and the redirect of old step keys
// (`setup?step=vendors&form=…`).

export type FormFlowKey = 'special-guests' | 'registration';
/** Flows from before forms lost their type: `/setup/<one>` redirects to `/setup/registration`. */
export const LEGACY_FLOWS = new Set(['vendors', 'volunteers', 'other-applications']);
export type FlowStepKey = 'lineup' | 'start' | 'options' | 'payment' | 'floor-map' | 'questions' | 'review';

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
const onMap = (form: FlowForm | null) => !!form && form.spaceSelection === 'MAP';
/** Spec 057: a registration form starts free, so before it exists it counts as free. */
const paidForm = (form: FlowForm | null) => !!form && form.kind === 'PAID';

const s = (key: FlowStepKey, title: string, intro: string, rest: Partial<FlowStep> = {}): FlowStep => ({
  key, title, intro, needsForm: key !== 'start' && key !== 'lineup', visible: always, anchor: 'get-involved', formAnchor: null, ...rest,
});

const questions = s('questions', 'Fields', 'Email is always asked. Add any other fields you need.', { formAnchor: 'step-questions' });

export const FORM_FLOWS: Record<FormFlowKey, { title: string; steps: FlowStep[] }> = {
  // A live event's lineup: guests are added by hand, or from an approved application (AddToLineup).
  'special-guests': {
    title: 'Special guests',
    steps: [s('lineup', 'Special guest lineup', 'Add the guests you have booked. The lineup shows on the event page.', { anchor: 'guests' })],
  },
  // Spec 057: between the event's Image and Collect more steps; the event wizard's Review publishes.
  registration: {
    title: 'Registration form',
    steps: [
      // The form has no name or intro of its own: the event's Name step sets both (one page).
      s('start', 'Free or paid?', 'Anyone can register: vendors, volunteers, members. Decide whether the people you approve pay.', { formAnchor: 'apply-top' }),
      s('options', 'Options and pricing', 'The second step for registrants: once you approve them, they choose one of these options and pay. Set a price and a number of spots for each.', { visible: paidForm, formAnchor: 'apply-summary', preview: 'space' }),
      s('payment', 'How registrants choose and pay', 'Registration is free. Once you approve someone, they choose and pay.', { visible: paidForm, formAnchor: 'apply-summary', preview: 'space' }),
      s('floor-map', 'Floor map', 'Registrants pick their spot on the floor map of the event this is for.', { visible: onMap, anchor: 'floor-map' }),
      questions,
    ],
  },
};

export const isFormFlow = (key: string): key is FormFlowKey => key === 'registration' || key === 'special-guests';

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

/** The flow that edits a form, at its Start: a registration event's `registration` flow (spec 057). */
export const formEditHref = (eventId: string, form: { id: string }, org?: string | null) =>
  formFlowHref(eventId, 'registration', { form: form.id, step: 'start', org });

/**
 * The event wizard's old application step keys (spec 050), still in emails,
 * bookmarks and readiness items: where they live now. Null for any other key.
 * Special guests without a form is the lineup; everything else is the
 * registration flow (a live event's is redirected back to the event).
 */
export function legacyFlowHref(eventId: string, step: string | null, formId: string | null, org?: string | null): string | null {
  if (!step || !(step === 'floor-map' || isFormFlow(step) || LEGACY_FLOWS.has(step))) return null;
  if (step === 'special-guests' && !formId) return formFlowHref(eventId, 'special-guests', { step: 'lineup', org });
  return formFlowHref(eventId, 'registration', { form: formId, step: formId ? (step === 'floor-map' ? 'floor-map' : 'start') : undefined, org });
}
