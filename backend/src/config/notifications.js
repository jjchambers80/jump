// Spec 053: registry of system emails a store can edit on Settings ›
// Notifications. One entry per key; the API list, validation, defaults and
// the dialog's "Added automatically" note all read from here. A key is a
// string, never a Prisma enum, so adding an email needs no migration.
//
// The template is the wording only (subject + plain-text message). Anything
// that carries function or money — order lines, totals, buttons, links — is a
// system block the renderer appends, so a store can never remove the way to
// its tickets or type a wrong amount.

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
];

export const NOTIFICATION_GROUPS = [{ key: 'orders', label: 'Orders & tickets' }];

export const NOTIFICATIONS_BY_KEY = new Map(NOTIFICATIONS.map((n) => [n.key, n]));
