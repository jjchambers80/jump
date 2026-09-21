// Applications configuration (spec 011)
// Limits, question types, and the default decision emails an organization
// starts with. Templates are plain text with {{merge.fields}}; every value is
// HTML-escaped when rendered into the branded email shell.

export const MAX_PROFILE_PHOTOS = 6;
export const MAX_PHOTO_MB = 5;
export const MAX_FILES_PER_SUBMISSION = 12;
export const STATUS_TOKEN_TTL_DAYS = 180;
export const MAX_ANSWER_LENGTH = 5000;
export const MAX_OPTIONS = 30;
export const LIST_PAGE_SIZE = 50;
/** Spec 019: caps on a hand-edited form template definition. */
export const MAX_TEMPLATE_TIERS = 50;
export const MAX_TEMPLATE_QUESTIONS = 100;
/** Spec 019 phase 3: organizer tags per application. */
export const MAX_TAGS = 20;
export const MAX_TAG_LENGTH = 40;
/** Spec 019 follow-up: questions a form may pin as list columns. */
export const MAX_PINNED_QUESTIONS = 2;
/** Spec 014 phase 2: self-serve booth holds and their expiry sweep. */
export const BOOTH_HOLD_MS = Number.parseInt(process.env.BOOTH_HOLD_MS || '900000', 10);
export const BOOTH_SWEEP_INTERVAL_MS = Number.parseInt(process.env.BOOTH_SWEEP_INTERVAL_MS || '60000', 10);

export const QUESTION_TYPES = new Set([
  'SHORT_TEXT',
  'LONG_TEXT',
  'SINGLE_CHOICE',
  'MULTI_CHOICE',
  'CHECKBOX',
  'URL',
  'EMAIL',
  'PHONE',
  'NUMBER',
  'PHOTO',
]);
export const CHOICE_TYPES = new Set(['SINGLE_CHOICE', 'MULTI_CHOICE']);

export const SOCIAL_KEYS = ['instagram', 'tiktok', 'facebook', 'x', 'youtube', 'other'];

/** Merge fields organizers may use, with the description shown in the template editor. */
export const MERGE_FIELDS = [
  ['applicant.firstName', 'Applicant first name'],
  ['applicant.lastName', 'Applicant last name'],
  ['applicant.email', 'Applicant email'],
  ['profile.businessName', 'Business or outlet name'],
  ['event.name', 'Event name'],
  ['event.date', 'Event date'],
  ['organization.name', 'Your organization name'],
  ['form.name', 'Application form name'],
  ['tier.name', 'Selected tier'],
  ['addOns.summary', 'Add-ons chosen, e.g. "Booth power ×1 ($125.00), Extra badge ×2 ($20.00)" (empty when none)'],
  ['amount.applicantPays', 'Amount charged to the applicant'],
  ['order.ref', 'Order number of the application (e.g. JMP-K7M2PQ); empty on free forms'],
  ['payment.dueDate', 'Payment due date'],
  ['links.status', 'Link to the application status page'],
  ['links.payNow', 'Link to pay an outstanding balance'],
  ['links.account', 'Link to the applicant account page (on the RECEIVED email, a one-time sign-in link when the applicant just created an account)'],
  ['account.created', 'Section flag: true on the RECEIVED email when the applicant chose to create an account'],
];

/** Actions that have a template. PAYMENT_DUE is used from phase 2; ADD_ONS_CHANGED from spec 012; TIER_CHANGED / WAIVED / OFFLINE_PAID from spec 018. */
export const TEMPLATE_ACTIONS = ['RECEIVED', 'APPROVED', 'REJECTED', 'WAITLISTED', 'WITHDRAWN', 'PAYMENT_DUE', 'ADD_ONS_CHANGED', 'TIER_CHANGED', 'WAIVED', 'OFFLINE_PAID'];

export const DEFAULT_TEMPLATES = {
  RECEIVED: {
    subject: 'We received your application for {{event.name}}',
    body: `Hi {{applicant.firstName}},

Thanks for applying to {{event.name}} as {{form.name}}{{#tier}} ({{tier.name}}){{/tier}}. We have your application and will review it soon.
{{#addOns}}
Add-ons: {{addOns.summary}}
{{/addOns}}
{{#order.ref}}
Order number: {{order.ref}}
{{/order.ref}}
You can check its status any time: {{links.status}}
{{#account.created}}

Your account with {{organization.name}} is ready — no password needed. Sign in any time from this link (it works once and expires in 7 days): {{links.account}}
{{/account.created}}

{{organization.name}}`,
  },
  APPROVED: {
    subject: 'You are approved for {{event.name}}',
    body: `Hi {{applicant.firstName}},

Good news — {{profile.businessName}} is approved for {{event.name}}{{#tier}} ({{tier.name}}){{/tier}}.
{{#order.ref}}
Order number: {{order.ref}}
{{/order.ref}}
We will follow up with logistics closer to the event. Your application: {{links.status}}

See you there,
{{organization.name}}`,
  },
  REJECTED: {
    subject: 'Your application for {{event.name}}',
    body: `Hi {{applicant.firstName}},

Thank you for applying to {{event.name}}. We are not able to offer {{profile.businessName}} a spot this time. We hope you will apply again for a future event.

{{organization.name}}`,
  },
  WAITLISTED: {
    subject: 'You are on the waitlist for {{event.name}}',
    body: `Hi {{applicant.firstName}},

{{profile.businessName}} is on the waitlist for {{event.name}}{{#tier}} ({{tier.name}}){{/tier}}. We will let you know as soon as a spot opens up.

Your application: {{links.status}}

{{organization.name}}`,
  },
  WITHDRAWN: {
    subject: 'Your application for {{event.name}} has been withdrawn',
    body: `Hi {{applicant.firstName}},

Your application for {{event.name}} ({{form.name}}) has been withdrawn. If this was unexpected, reply to this email and we will sort it out.

{{organization.name}}`,
  },
  PAYMENT_DUE: {
    subject: 'Payment needed to confirm your spot at {{event.name}}',
    body: `Hi {{applicant.firstName}},

{{profile.businessName}} is approved for {{event.name}}{{#tier}} ({{tier.name}}){{/tier}}, but we could not charge the card on file. Please pay {{amount.applicantPays}} by {{payment.dueDate}} to keep your spot{{#order.ref}} (order {{order.ref}}){{/order.ref}}:

{{links.payNow}}

{{organization.name}}`,
  },
  ADD_ONS_CHANGED: {
    subject: 'Your {{event.name}} application was updated',
    body: `Hi {{applicant.firstName}},

We updated the add-ons on {{profile.businessName}}'s application for {{event.name}}{{#tier}} ({{tier.name}}){{/tier}}.

Add-ons: {{addOns.summary}}
New total: {{amount.applicantPays}}

Your application: {{links.status}}

{{organization.name}}`,
  },
  TIER_CHANGED: {
    subject: 'Your {{event.name}} application was moved to {{tier.name}}',
    body: `Hi {{applicant.firstName}},

We moved {{profile.businessName}}'s application for {{event.name}} to {{tier.name}}.
{{#addOns}}
Add-ons: {{addOns.summary}}
{{/addOns}}
New total: {{amount.applicantPays}}

Your application: {{links.status}}

{{organization.name}}`,
  },
  WAIVED: {
    subject: 'Your balance for {{event.name}} has been waived',
    body: `Hi {{applicant.firstName}},

Good news: the balance on {{profile.businessName}}'s application for {{event.name}}{{#tier}} ({{tier.name}}){{/tier}} has been waived. Nothing is owed and your spot is confirmed.

Your application: {{links.status}}

{{organization.name}}`,
  },
  OFFLINE_PAID: {
    subject: 'Payment received for {{event.name}}',
    body: `Hi {{applicant.firstName}},

We recorded your payment of {{amount.applicantPays}} for {{profile.businessName}}'s application to {{event.name}}{{#tier}} ({{tier.name}}){{/tier}}{{#order.ref}} (order {{order.ref}}){{/order.ref}}. Your spot is confirmed.

Your application: {{links.status}}

{{organization.name}}`,
  },
};
