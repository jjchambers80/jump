// Spec 053: registry of system emails a store can edit on Settings ›
// Notifications. One entry per key; the API list, validation, defaults and
// the dialog's "Added automatically" note all read from here. A key is a
// string, never a Prisma enum, so adding an email needs no migration.
//
// The template is the wording only (subject + plain-text message). Anything
// that carries function or money — order lines, totals, buttons, links — is a
// system block the renderer appends, so a store can never remove the way to
// its tickets or type a wrong amount.
//
// `optional: true` lets the store switch the email off (only reminders;
// confirmations, receipts and cancellations always go out).

export const NOTIFICATIONS = [
  {
    key: 'order.confirmation',
    group: 'orders',
    label: 'Order confirmation',
    when: 'Sent to the buyer when a ticket order is paid.',
    mergeFields: [
      ['buyer.firstName', 'Buyer first name ("there" when unknown)'],
      ['buyer.lastName', 'Buyer last name'],
      ['event.name', 'Event name'],
      ['event.date', 'Event date and time in the venue time zone'],
      ['order.ref', 'Order reference'],
      ['order.total', 'Order total, e.g. $52.50'],
      ['organization.name', 'Your store name'],
    ],
    blocks: ['Order summary: tickets, add-ons and total', 'View tickets button and how to use the QR codes', 'Account sign-in box, when the buyer created an account'],
    defaults: {
      subject: 'Order Confirmed — {{event.name}} ({{order.ref}})',
      body: 'Hi {{buyer.firstName}},\n\nYour order {{order.ref}} has been confirmed.',
    },
  },
  {
    key: 'rsvp.confirmation',
    group: 'rsvps',
    label: 'RSVP confirmation',
    when: 'Sent to the guest when they RSVP to a free event.',
    mergeFields: [
      ['guest.firstName', 'Guest first name ("there" when unknown)'],
      ['guest.lastName', 'Guest last name'],
      ['event.name', 'Event name'],
      ['event.date', 'Event date and time in the venue time zone'],
      ['rsvp.partySize', 'Number of people in the party'],
      ['organization.name', 'Your store name'],
    ],
    blocks: ['Event details: when, where and party size', 'Cancel your RSVP link', 'Calendar invite (.ics) attached'],
    defaults: {
      subject: "You're on the list — {{event.name}}",
      body: 'Hi {{guest.firstName}},\n\nYour RSVP for {{event.name}} is confirmed.',
    },
  },
  {
    key: 'rsvp.reminder',
    group: 'rsvps',
    label: 'RSVP reminder',
    when: 'Sent to each guest about 24 hours before the event.',
    optional: true,
    mergeFields: [
      ['guest.firstName', 'Guest first name ("there" when unknown)'],
      ['guest.lastName', 'Guest last name'],
      ['event.name', 'Event name'],
      ['event.date', 'Event date and time in the venue time zone'],
      ['rsvp.partySize', 'Number of people in the party'],
      ['organization.name', 'Your store name'],
    ],
    blocks: ['Event details: when and party size', 'Cancel RSVP button', 'Why the guest got this email'],
    defaults: {
      subject: 'Reminder: {{event.name}} is happening tomorrow — {{organization.name}}',
      body:
        "Hi {{guest.firstName}},\n\nThis is a reminder that you're on the list for {{event.name}}.\n\nYou can cancel your RSVP at any time. Please let us know if your plans change so we can open the spot to someone else.",
    },
  },
  {
    key: 'rsvp.cancelled',
    group: 'rsvps',
    label: 'Event cancelled',
    when: 'Sent to every guest when you cancel an RSVP event.',
    mergeFields: [
      ['guest.firstName', 'Guest first name ("there" when unknown)'],
      ['guest.lastName', 'Guest last name'],
      ['event.name', 'Event name'],
      ['event.date', 'Event date and time in the venue time zone'],
      ['organization.name', 'Your store name'],
    ],
    blocks: ['The event date and time'],
    defaults: {
      subject: 'Event Cancelled — {{event.name}}',
      body:
        "Hi {{guest.firstName}},\n\nWe're sorry to tell you that {{event.name}} has been cancelled. Your RSVP has been cancelled; no action is needed.\n\nIf you have questions, reply to this email.",
    },
  },
  {
    key: 'application.receipt',
    group: 'applicationPayments',
    label: 'Application payment receipt',
    when: 'Sent to the vendor when an application order is paid, by card or recorded offline.',
    mergeFields: [
      ['applicant.firstName', 'Applicant first name ("there" when unknown)'],
      ['applicant.lastName', 'Applicant last name'],
      ['profile.businessName', 'Business name'],
      ['event.name', 'Event name'],
      ['event.date', 'Event date and time in the venue time zone'],
      ['tier.name', 'Space category, e.g. 10x10'],
      ['order.ref', 'Order number'],
      ['order.total', 'Total paid, e.g. $275.00'],
      ['organization.name', 'Your store name'],
    ],
    blocks: ['Receipt: each line, total paid and payment method', 'The booth this payment bought, with a map link', 'View your application button and account link'],
    defaults: {
      subject: 'Receipt for {{event.name}} ({{order.ref}})',
      body: "Hi {{applicant.firstName}},\n\nThis is your receipt for {{profile.businessName}}'s application to {{event.name}}{{#tier.name}} ({{tier.name}}){{/tier.name}}.",
    },
  },
];

export const NOTIFICATION_GROUPS = [
  { key: 'orders', label: 'Orders & tickets' },
  { key: 'rsvps', label: 'RSVPs' },
  { key: 'applicationPayments', label: 'Application payments' },
];

export const NOTIFICATIONS_BY_KEY = new Map(NOTIFICATIONS.map((n) => [n.key, n]));
