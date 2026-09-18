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
