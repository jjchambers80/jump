// Steps 8, 10, 11 and 12 of the event setup wizard (spec 050 §5.2, card
// 050-L): one ApplicationsStep per purpose group. Forms save on their own
// (dialogs and the FormEditorCards), so these steps have no event payload.
//
// Pure module, type-only imports from steps.ts (it imports this file).

import type { FormKind, FormPurpose, FormTemplateSummary } from '@/lib/applications';
import type { EventStep, StepCtx } from './steps';

export type ApplicationStepKey = 'vendors' | 'special-guests' | 'volunteers' | 'other-applications';

export interface ApplicationStepConfig {
  /** The purposes listed on the step; the first is the one a new form gets. */
  purposes: FormPurpose[];
  /** "Add a vendor application". */
  addLabel: string;
  /** Empty state: what forms on this step are for. */
  empty: string;
  /** Name prefill after the event name. */
  nameSuffix: string;
  /** Kind a new form starts with. */
  defaultKind: FormKind;
}

export const PURPOSE_LABEL: Record<FormPurpose, string> = {
  VENDOR: 'Vendor',
  SPONSOR: 'Sponsor',
  PRESS: 'Press',
  PANEL: 'Panel',
  SPECIAL_GUEST: 'Special guest',
  VOLUNTEER: 'Volunteer',
  OTHER: 'Other',
};

/** Spec 050 §3: never charged (400 PURPOSE_KIND_MISMATCH). The reason is shown in text. */
export const FREE_ONLY: Partial<Record<FormPurpose, string>> = {
  SPECIAL_GUEST: 'Special guest applications are always free: guests are not charged to appear.',
  VOLUNTEER: 'Volunteer applications are always free: volunteers give their time.',
};

export const APPLICATION_STEPS: Record<ApplicationStepKey, ApplicationStepConfig> = {
  vendors: {
    purposes: ['VENDOR'],
    addLabel: 'Add a vendor application',
    empty: 'Vendors apply here for a space at your event. You review each one, then they choose a space and pay.',
    nameSuffix: 'Vendor Application',
    defaultKind: 'PAID',
  },
  'special-guests': {
    purposes: ['SPECIAL_GUEST'],
    addLabel: 'Add a special guest application',
    empty: 'Artists, creators and celebrities apply here to appear at your event.',
    nameSuffix: 'Special Guest Application',
    defaultKind: 'FREE',
  },
  volunteers: {
    purposes: ['VOLUNTEER'],
    addLabel: 'Add a volunteer application',
    empty: 'People sign up here to help run your event. They give a name, an email and your questions; no business details.',
    nameSuffix: 'Volunteer Application',
    defaultKind: 'FREE',
  },
  'other-applications': {
    purposes: ['SPONSOR', 'PRESS', 'PANEL', 'OTHER'],
    addLabel: 'Add an application',
    empty: 'Sponsors, press and panel hosts apply here. Pick what each form is for.',
    nameSuffix: 'Application',
    defaultKind: 'FREE',
  },
};

export const isApplicationStep = (key: string): key is ApplicationStepKey => key in APPLICATION_STEPS;

/** The forms that belong on a step. A form without a purpose (older payload) is OTHER. */
export const formsOnStep = <F extends { purpose?: FormPurpose | null }>(key: ApplicationStepKey, forms: F[] = []) =>
  forms.filter((f) => APPLICATION_STEPS[key].purposes.includes(f.purpose ?? 'OTHER'));

/** The step a form's purpose places it on (deep links: `setup?step=<key>&form=<id>`). */
export const stepForPurpose = (purpose: FormPurpose | null | undefined): ApplicationStepKey =>
  (Object.keys(APPLICATION_STEPS) as ApplicationStepKey[]).find((key) => APPLICATION_STEPS[key].purposes.includes(purpose ?? 'OTHER'))!;

/** Templates for this purpose and kind; else same-kind templates saved before purposes existed. */
export function templatesFor(templates: FormTemplateSummary[], purpose: FormPurpose, kind: FormKind) {
  const sameKind = templates.filter((t) => t.kind === kind);
  const matching = sameKind.filter((t) => t.purpose === purpose);
  return matching.length ? matching : sameKind.filter((t) => !t.purpose);
}

/** Where FormEditorCards link out to, inside the wizard: its own steps, not the old event pages. */
export const wizardLink = (eventId: string, target: 'floor-map' | 'add-ons') =>
  target === 'floor-map'
    ? { href: `/admin/events/${eventId}/setup?step=floor-map`, label: 'Go to the Floor map step' }
    : { href: `/admin/events/${eventId}/setup?step=collect-more`, label: 'Collect more step' };

const always = () => true;

function step(key: ApplicationStepKey, title: string, rest: Partial<EventStep> = {}): EventStep {
  return {
    key, title, rule: 'S', anchor: 'get-involved', built: true, visible: always,
    complete: (ctx: StepCtx) => formsOnStep(key, ctx.forms).length > 0,
    ...rest,
  };
}

export const VENDORS_STEP = step('vendors', 'Vendor applications');
export const SPECIAL_GUESTS_STEP = step('special-guests', 'Special guests');
export const VOLUNTEERS_STEP = step('volunteers', 'Volunteers');
export const OTHER_APPLICATIONS_STEP = step('other-applications', 'Other applications');
