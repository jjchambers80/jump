// Onboarding survey options and labels (spec 022).
// Ids mirror backend/src/config/onboarding.js exactly — a backend contract
// test asserts every id there appears here. Labels and copy live only here.

export interface SurveyOption {
  id: string;
  label: string;
}

export interface SurveyStep {
  key: 'goals' | 'eventTypes' | 'eventsPerYear' | 'attendance' | 'movingFrom';
  title: string;
  subtitle: string;
  multi: boolean;
  options: SurveyOption[];
  /** Only asked when the goals answer includes this id. */
  requiresGoal?: string;
}

export const SURVEY_STEPS: SurveyStep[] = [
  {
    key: 'goals',
    title: 'What can we help you do?',
    subtitle: "Select all that apply. We'll tailor your setup.",
    multi: true,
    options: [
      { id: 'sell_online', label: 'Sell tickets online' },
      { id: 'sell_at_door', label: 'Sell tickets at the door' },
      { id: 'vendor_applications', label: 'Manage vendor & sponsor applications' },
      { id: 'press_applications', label: 'Accept press & panel applications' },
      { id: 'add_ons_merch', label: 'Sell add-ons and merch' },
      { id: 'move_platform', label: 'Move from another platform' },
    ],
  },
  {
    key: 'eventTypes',
    title: 'What kind of events do you run?',
    subtitle: 'Pick the closest matches.',
    multi: true,
    options: [
      { id: 'convention_expo', label: 'Conventions & expos' },
      { id: 'festival', label: 'Festivals' },
      { id: 'concert', label: 'Concerts & live music' },
      { id: 'conference', label: 'Conferences & workshops' },
      { id: 'sports', label: 'Sports & tournaments' },
      { id: 'community_nonprofit', label: 'Community & nonprofit' },
      { id: 'other', label: 'Other' },
    ],
  },
  {
    key: 'eventsPerYear',
    title: 'How many events do you run a year?',
    subtitle: 'A rough number is fine.',
    multi: false,
    options: [
      { id: 'one', label: 'Just one' },
      { id: 'two_to_five', label: '2–5' },
      { id: 'six_to_twenty', label: '6–20' },
      { id: 'twenty_plus', label: 'More than 20' },
    ],
  },
  {
    key: 'attendance',
    title: 'How many people come to a typical event?',
    subtitle: 'Helps us size your capacity and check-in tools.',
    multi: false,
    options: [
      { id: 'under_100', label: 'Under 100' },
      { id: '100_500', label: '100–500' },
      { id: '500_2000', label: '500–2,000' },
      { id: '2000_10000', label: '2,000–10,000' },
      { id: '10000_plus', label: '10,000+' },
    ],
  },
  {
    key: 'movingFrom',
    title: 'Where are you moving from?',
    subtitle: "We'll point you at the import tools that fit.",
    multi: false,
    requiresGoal: 'move_platform',
    options: [
      { id: 'eventeny', label: 'Eventeny' },
      { id: 'eventbrite', label: 'Eventbrite' },
      { id: 'ticketmaster_universe', label: 'Ticketmaster / Universe' },
      { id: 'etix', label: 'Etix' },
      { id: 'square', label: 'Square' },
      { id: 'spreadsheets', label: 'Spreadsheets or nothing yet' },
      { id: 'other', label: 'Somewhere else' },
    ],
  },
];

export interface SurveyAnswers {
  goals?: string[];
  eventTypes?: string[];
  eventsPerYear?: string | null;
  attendance?: string | null;
  movingFrom?: string | null;
}

/** Steps to show for the current answers (the moving-from step is conditional). */
export function visibleSteps(answers: SurveyAnswers): SurveyStep[] {
  return SURVEY_STEPS.filter((step) => !step.requiresGoal || (answers.goals ?? []).includes(step.requiresGoal));
}

export type SignupStep = 'subscribe' | 'survey' | 'done';

export interface PendingOrganization {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  step: SignupStep;
  onboarding: (SurveyAnswers & { source?: string; surveySkippedAt?: string; subscribeSkippedAt?: string }) | null;
}

/** Path of the signup page for a pending organization's next step. */
export function signupPathFor(org: PendingOrganization): string {
  return `/signup/${org.id}/${org.step}`;
}

/** Human label for a survey option id, by step key. */
export function surveyLabel(key: SurveyStep['key'], id: string | null | undefined): string | null {
  if (!id) return null;
  const step = SURVEY_STEPS.find((s) => s.key === key);
  return step?.options.find((o) => o.id === id)?.label ?? id;
}

/** Survey summary as listed for SYSTEM_ADMIN on GET /organizations (spec 022 phase 3). */
export interface OnboardingSummary {
  source: string | null;
  goals: string[];
  eventTypes: string[];
  eventsPerYear: string | null;
  attendance: string | null;
  movingFrom: string | null;
  surveySkipped: boolean;
}

export interface OnboardingFunnel {
  windows: Record<string, { started: number; completed: number; subscribed: number }>;
  pending: number;
}
