// The four application types (spec 050 §5.2), each set up in its own flow
// since spec 051 (formFlows.ts): purposes, labels and new-form defaults.
//
// Pure module.

import type { FormKind, FormPurpose } from '@/lib/applications';

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
    empty: 'Artists, creators and celebrities apply here to appear at your event. A form is optional: you can add guests to the lineup by hand below.',
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

/**
 * Spec 057: a registration event's one form, for anyone the organizer chooses.
 * Generic on purpose: no type to pick (always OTHER). Its name and button label
 * say who registers, so any business can use it.
 */
export const REGISTRATION_CONFIG: ApplicationStepConfig = {
  purposes: ['OTHER'],
  addLabel: 'Set up the registration form',
  empty: 'People register here. You review each one.',
  nameSuffix: '',
  defaultKind: 'FREE',
};

export const isApplicationStep = (key: string): key is ApplicationStepKey => key in APPLICATION_STEPS;

/** The forms that belong on a step. A form without a purpose (older payload) is OTHER. */
export const formsOnStep = <F extends { purpose?: FormPurpose | null }>(key: ApplicationStepKey, forms: F[] = []) =>
  forms.filter((f) => APPLICATION_STEPS[key].purposes.includes(f.purpose ?? 'OTHER'));

/** The step a form's purpose places it on (deep links: `setup?step=<key>&form=<id>`). */
export const stepForPurpose = (purpose: FormPurpose | null | undefined): ApplicationStepKey =>
  (Object.keys(APPLICATION_STEPS) as ApplicationStepKey[]).find((key) => APPLICATION_STEPS[key].purposes.includes(purpose ?? 'OTHER'))!;

/** Where FormEditorCards link out to: the vendor flow's Floor map step (spec 051), the event wizard's Collect more. */
export const wizardLink = (eventId: string, target: 'floor-map' | 'add-ons', formId?: string) =>
  target === 'floor-map'
    ? {
        href: `/admin/events/${encodeURIComponent(eventId)}/setup/vendors?${new URLSearchParams({ step: 'floor-map', ...(formId && { form: formId }) })}`,
        label: 'Go to the Floor map step',
      }
    : { href: `/admin/events/${eventId}/setup?step=collect-more`, label: 'Collect more step' };
