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
//
// Application decision emails (spec 011 / 044) have no system blocks: the
// message is the whole email, and staff can still edit it per applicant in
// the decision dialog. Their defaults and merge fields live in
// config/applications.js; spec 053-D moved their storage here.

import { DEFAULT_TEMPLATES, MERGE_FIELDS, STANDING_DEFAULT_TEMPLATES, STANDING_TEMPLATE_ACTIONS, TEMPLATE_ACTIONS } from './applications.js';

const EVENT_APPLICATION_COPY = {
  RECEIVED: ['Application received', 'Sent when someone submits an application.'],
  APPROVED: ['Approved', 'Free forms: sent on approval. Paid forms: sent once the space is paid.'],
  CHOOSE_SPACE: ['Choose your space', 'Paid forms: sent on approval, asking the vendor to pick a space and pay.'],
  REJECTED: ['Rejected', 'Sent when you reject an application.'],
  WAITLISTED: ['Waitlisted', 'Sent when you move an application to the waitlist.'],
  WITHDRAWN: ['Withdrawn', 'Sent when an application is withdrawn.'],
  PAYMENT_DUE: ['Payment due', 'Paid forms: sent when a balance is due.'],
  ADD_ONS_CHANGED: ['Add-ons changed', 'Paid forms: sent when you change the add-ons on an application.'],
  TIER_CHANGED: ['Tier changed', 'Paid forms: sent when you move an application to another tier.'],
  WAIVED: ['Balance waived', 'Paid forms: sent when you waive the balance.'],
  OFFLINE_PAID: ['Payment recorded offline', 'Paid forms: sent when you record a payment taken outside Eventimus.'],
};
const STANDING_APPLICATION_COPY = {
  RECEIVED: ['Application received', 'Sent when someone submits a standing form.'],
  APPROVED: ['Approved', 'Sent when you approve a standing-form application.'],
  WAITLISTED: ['Waitlisted', 'Sent when you move a standing-form application to the waitlist.'],
  REJECTED: ['Rejected', 'Sent when you reject a standing-form application.'],
};

/** Registry key of an application decision email. */
export const applicationKey = (scope, action) => `application.${scope === 'STANDING' ? 'standing' : 'event'}.${action}`;

const applicationEntries = (scope, actions, copy, defaults) =>
  actions.map((action) => ({
    key: applicationKey(scope, action),
    group: scope === 'STANDING' ? 'standingForms' : 'applications',
    label: copy[action][0],
    when: copy[action][1],
    mergeFields: MERGE_FIELDS,
    blocks: [],
    application: { scope, action },
    defaults: defaults[action],
  }));

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
    key: 'order.event_cancelled',
    group: 'orders',
    label: 'Event cancelled',
    when: 'Sent to every buyer when you cancel a paid event: after the refund when you refund every order, at once when you handle refunds yourself.',
    mergeFields: [
      ['buyer.firstName', 'Buyer first name ("there" when unknown)'],
      ['buyer.lastName', 'Buyer last name'],
      ['event.name', 'Event name'],
      ['event.date', 'Event date and time in the venue time zone'],
      ['order.ref', 'Order reference'],
      ['refund.amount', 'Amount refunded, e.g. $52.50 (empty when you handle refunds yourself)'],
      ['refund.issued', 'Section: shown when the order was refunded, e.g. {{#refund.issued}}…{{/refund.issued}}'],
      ['refund.manual', 'Section: shown when you handle refunds yourself, e.g. {{#refund.manual}}…{{/refund.manual}}'],
      ['organization.name', 'Your store name'],
    ],
    blocks: ['Your note from the cancel dialog, when you write one', 'Order summary: tickets and total', 'Refund amount and when it reaches the card, when the order was refunded'],
    defaults: {
      subject: 'Event Cancelled — {{event.name}} ({{order.ref}})',
      body:
        "Hi {{buyer.firstName}},\n\nWe're sorry: {{event.name}} on {{event.date}} has been cancelled.\n\n{{#refund.issued}}We've refunded {{refund.amount}} for your order {{order.ref}}. Your tickets no longer work.{{/refund.issued}}{{#refund.manual}}{{organization.name}} will contact you about your order {{order.ref}}.{{/refund.manual}}\n\nIf you have questions, reply to this email.",
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
  ...applicationEntries('EVENT', TEMPLATE_ACTIONS, EVENT_APPLICATION_COPY, DEFAULT_TEMPLATES),
  ...applicationEntries('STANDING', STANDING_TEMPLATE_ACTIONS, STANDING_APPLICATION_COPY, STANDING_DEFAULT_TEMPLATES),
];

export const NOTIFICATION_GROUPS = [
  { key: 'orders', label: 'Orders & tickets' },
  { key: 'rsvps', label: 'RSVPs' },
  { key: 'applicationPayments', label: 'Application payments' },
  { key: 'applications', label: 'Event applications' },
  { key: 'standingForms', label: 'Standing forms (Content › Forms)' },
];

export const NOTIFICATIONS_BY_KEY = new Map(NOTIFICATIONS.map((n) => [n.key, n]));
