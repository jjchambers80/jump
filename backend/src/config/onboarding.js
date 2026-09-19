// Onboarding survey options (spec 022).
// Single source of truth for the ids the /signup survey may store on
// PlatformCustomer.onboarding. frontend/src/lib/onboarding.ts mirrors these
// ids with their labels; a contract test asserts both lists match.

export const ONBOARDING_VERSION = 1;

export const ONBOARDING_SURVEY = {
  // "What can we help you do?" — multi-select
  goals: ['sell_online', 'sell_at_door', 'vendor_applications', 'press_applications', 'add_ons_merch', 'move_platform'],
  // "What kind of events do you run?" — multi-select
  eventTypes: ['convention_expo', 'festival', 'concert', 'conference', 'sports', 'community_nonprofit', 'other'],
  // "How many events do you run a year?" — single
  eventsPerYear: ['one', 'two_to_five', 'six_to_twenty', 'twenty_plus'],
  // "How many people come to a typical event?" — single
  attendance: ['under_100', '100_500', '500_2000', '2000_10000', '10000_plus'],
  // "Where are you moving from?" — single, only asked after move_platform
  movingFrom: ['eventeny', 'eventbrite', 'ticketmaster_universe', 'etix', 'square', 'spreadsheets', 'other'],
};

export const MULTI_SELECT_KEYS = ['goals', 'eventTypes'];
export const SINGLE_SELECT_KEYS = ['eventsPerYear', 'attendance', 'movingFrom'];

/** Survey goals that make the setup guide show the applications card. */
export const APPLICATION_GOALS = ['vendor_applications', 'press_applications'];

/** Unfinished signups a user may hold at once before they must finish or discard one. */
export const MAX_PENDING_ORGANIZATIONS = 3;

export const SIGNUP_SOURCES = ['admin', 'public'];

/** Survey goal that makes the setup guide show the on-site check-in card. */
export const CHECKIN_GOAL = 'sell_at_door';

/** Unfinished signups older than this with no events and no subscription are deleted by the sweep. */
export const ABANDON_AFTER_MS = Number(process.env.ONBOARDING_ABANDON_AFTER_MS) || 7 * 24 * 60 * 60 * 1000;

/**
 * Application form templates seeded into an organization whose survey chose
 * vendor / sponsor or press / panel applications (spec 022 phase 3), so the
 * setup guide's "Set up applications" lands on a non-empty Templates tab.
 * Definitions go through ApplicationFormTemplateService.validateDefinition.
 */
export const SEED_TEMPLATES = [
  {
    name: 'Vendor booth',
    kind: 'PAID',
    definition: {
      intro: 'Tell us about your business and pick a booth. Booths are confirmed on approval; your card is charged then.',
      chargeTiming: 'APPROVAL',
      feeMode: 'PASS',
      taxable: false,
      paymentDueDays: 7,
      overduePolicy: 'WITHDRAW',
      tiers: [
        { name: 'Standard booth (10×10)', description: 'One table, two chairs, two vendor badges.', price: 275, quantityTotal: 100, isActive: true },
        { name: 'Corner booth (10×10)', description: 'Two open sides, one table, two chairs, two vendor badges.', price: 350, quantityTotal: 20, isActive: true },
      ],
      questions: [
        { label: 'What do you sell?', type: 'LONG_TEXT', required: true, pinned: true },
        { label: 'Website or social link', type: 'URL', required: false },
        { label: 'Do you need power at your booth?', type: 'SINGLE_CHOICE', required: true, options: ['No', 'Yes, one outlet', 'Yes, more than one outlet'] },
        { label: 'Photos of your products or booth', type: 'PHOTO', required: false },
      ],
    },
  },
  {
    name: 'Press & media',
    kind: 'FREE',
    definition: {
      intro: 'Apply for a press badge. Tell us who you cover for and what you plan to publish.',
      questions: [
        { label: 'Outlet or channel', type: 'SHORT_TEXT', required: true, pinned: true },
        { label: 'Link to your recent work', type: 'URL', required: true },
        { label: 'What will you cover?', type: 'LONG_TEXT', required: false },
        { label: 'Media type', type: 'MULTI_CHOICE', required: true, options: ['Written', 'Photo', 'Video', 'Podcast / audio', 'Social'] },
      ],
    },
  },
];
