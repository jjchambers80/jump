// Permission catalog: what the member roles (ADMIN, ORGANIZER) may see and do.
//
// Two kinds of key, both edited per role in System › Roles:
// - a feature (`customers`, `maps`, …) is an area of the admin. Hidden for a
//   role → its nav entry disappears and its API answers 403
//   (`requireFeature`). Turned off platform-wide → 404 for everyone, SYSTEM_ADMIN
//   included. `locked` features hold the admin together and cannot be hidden.
// - an action (`orders.refund`, …) is a privileged operation inside a feature
//   (`requirePermission`). ADMIN has every action by default; ORGANIZER only
//   those marked `organizer: true` (event-scoped configuration, spec 050
//   decision 10). Money movement and settings stay ADMIN.
//
// Overrides live in PlatformSetting `roles` (PermissionService); this file is
// the only list of keys. A key used by a route but missing here throws at boot.

export const MEMBER_ROLES = ['ADMIN', 'ORGANIZER'];

/**
 * `adminPaths`: frontend /admin paths the feature owns, for the nav and the
 * redirect when it is hidden. `locked`: { ADMIN, ORGANIZER } values that can
 * never be changed (true for a locked feature).
 */
export const FEATURES = [
  { key: 'dashboard', label: 'Dashboard', locked: true, adminPaths: ['/admin/dashboard', '/admin/onboarding'], actions: [] },
  {
    key: 'events',
    label: 'Events',
    locked: true,
    adminPaths: ['/admin/events', '/admin/create-event'],
    actions: [
      { key: 'applications.forms', label: 'Build event application forms, categories, questions and templates', organizer: true },
      { key: 'applications.money', label: 'Refund, waive or record an offline payment on an application' },
      { key: 'addOns.manage', label: 'Create and edit add-ons and saved add-ons', organizer: true },
    ],
  },
  { key: 'venues', label: 'Venues', locked: true, adminPaths: ['/admin/venues'], actions: [] },
  {
    key: 'orders',
    label: 'Orders and check-in',
    locked: true,
    adminPaths: ['/admin/orders'],
    actions: [{ key: 'orders.refund', label: 'Refund orders, tickets and add-ons' }],
  },
  {
    key: 'customers',
    label: 'Customers',
    adminPaths: ['/admin/customers'],
    actions: [
      { key: 'customers.email', label: "Change a customer's email address" },
      { key: 'customers.comments', label: "Delete other staff members' timeline comments" },
      { key: 'customers.privacy', label: "Export, erase or anonymize a customer's data" },
    ],
  },
  {
    key: 'maps',
    label: 'Maps',
    adminPaths: ['/admin/maps'],
    actions: [{ key: 'maps.forceAssign', label: 'Assign a spot to an application from a different category' }],
  },
  { key: 'analytics', label: 'Analytics', adminPaths: ['/admin/analytics'], actions: [] },
  { key: 'finance', label: 'Finance', adminPaths: ['/admin/finance'], actions: [] },
  {
    key: 'onlineStore',
    label: 'Online store',
    adminPaths: ['/admin/online-store', '/admin/themes'],
    actions: [{ key: 'onlineStore.preferences', label: 'Change store preferences (access, SEO)' }],
  },
  {
    key: 'content',
    label: 'Content',
    adminPaths: ['/admin/content'],
    actions: [{ key: 'applications.standingForms', label: 'Build standing application forms (Content › Forms)' }],
  },
  {
    key: 'developer',
    label: 'Developer tools',
    adminPaths: ['/admin/settings/developers', '/admin/cli'],
    actions: [{ key: 'developer.manageAll', label: "See and revoke every staff member's CLI tokens" }],
  },
  {
    key: 'settings',
    label: 'Settings',
    locked: true,
    adminPaths: [],
    actions: [
      { key: 'settings.business', label: 'Edit organization details, logo and cover' },
      { key: 'settings.plan', label: 'Manage the Eventimus plan' },
      { key: 'settings.tax', label: 'Change tax settings' },
      { key: 'settings.payments', label: 'Change payment settings and the payout account' },
      { key: 'settings.customerAccounts', label: 'Change customer account and refund policy settings' },
      { key: 'settings.applications', label: 'Change application email templates and the digest' },
      { key: 'settings.agentAccess', label: 'Manage AI agent access' },
      { key: 'settings.activity', label: 'View the activity log' },
      // Locked: an Organizer who could manage users could make themselves Admin,
      // and an organization with no Admin able to manage users is stuck.
      { key: 'settings.users', label: 'Add, remove and change staff users', locked: { ADMIN: true, ORGANIZER: false } },
    ],
  },
];

export const FEATURE_KEYS = new Set(FEATURES.map((f) => f.key));
export const ACTION_KEYS = new Set(FEATURES.flatMap((f) => f.actions.map((a) => a.key)));

const ACTIONS = new Map(FEATURES.flatMap((f) => f.actions.map((a) => [a.key, a])));

/** Default value of a key for a member role. */
export function defaultFor(role, key) {
  if (FEATURE_KEYS.has(key)) return true;
  return role === 'ADMIN' || (role === 'ORGANIZER' && !!ACTIONS.get(key)?.organizer);
}

/** The fixed value of a locked key for a role, or undefined when it can be changed. */
export function lockedValue(role, key) {
  const feature = FEATURES.find((f) => f.key === key);
  if (feature) return feature.locked ? true : undefined;
  const action = FEATURES.flatMap((f) => f.actions).find((a) => a.key === key);
  return action?.locked?.[role];
}

/** Features that may be turned off platform-wide (every unlocked one). */
export const SWITCHABLE_FEATURES = new Set(FEATURES.filter((f) => !f.locked).map((f) => f.key));
