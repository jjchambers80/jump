// Contract tests for spec 037 phase 0: one Contact per (organization,
// normalized email), and nothing but a staff edit on the customer page
// changes who that Contact is.
//   C1 / D13  ticket attendee edit never changes the buyer's email; the name
//             edit is refused on a multi-ticket order
//   C3        every Contact upsert / lookup trims and lower-cases the email
//   C4 / D12  checkout and application submit fill in a missing name only
// Stripe and Resend mocked; Postgres is real.

import { jest } from '@jest/globals';
import request from 'supertest';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';
import { acceptances } from '../helpers/legal.js';

jest.unstable_mockModule('../../src/config/resend.js', () => ({
  default: { emails: { send: jest.fn(async () => ({ id: 'mock' })) } },
}));
jest.unstable_mockModule('../../src/config/stripe.js', () => ({
  default: {
    checkout: {
      sessions: {
        create: jest.fn(async () => ({
          id: `cs_custid_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          url: 'https://checkout.stripe.com/pay/cs_custid',
          payment_intent: null,
          metadata: {},
        })),
        retrieve: jest.fn(),
        expire: jest.fn(),
      },
    },
    customers: { create: jest.fn() },
    paymentIntents: { create: jest.fn(), retrieve: jest.fn() },
    setupIntents: { retrieve: jest.fn() },
    refunds: { create: jest.fn() },
    webhooks: { constructEvent: jest.fn() },
  },
}));

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');
const { default: paymentSettingsService } = await import('../../src/services/PaymentSettingsService.js');
const { default: buyerAuthService } = await import('../../src/services/BuyerAuthService.js');

paymentSettingsService._statusCache = {
  value: { provider: 'STRIPE', mode: 'test', charges: 'active', statementDescriptorPrefix: 'JUMP', capabilities: {}, manageUrl: '', radarUrl: '', error: null },
  expiresAt: Number.POSITIVE_INFINITY,
};

const TAG = 'custid037';
const auth = (token) => ['Authorization', `Bearer ${token}`];

describe('Customer identity (spec 037 phase 0)', () => {
  let adminToken;
  let org;
  let event;
  let rsvpEvent;
  let tier;
  let freeForm;
  const staffEmails = [`admin@${TAG}.test`];

  const contactOf = (email) =>
    prisma.contact.findUnique({ where: { organizationId_email: { organizationId: org.id, email } } });
  const contactsLike = (local) =>
    prisma.contact.findMany({ where: { organizationId: org.id, email: { contains: local, mode: 'insensitive' } } });

  const checkout = (email, firstName, lastName, quantity = 1) =>
    request(app)
      .post('/orders')
      .send({ eventId: event.id, items: [{ priceTierId: tier.id, quantity }], contact: { email, firstName, lastName } });

  const apply = (email, firstName, lastName) =>
    request(app)
      .post(`/events/${event.id}/applications`)
      .send({
        formSlug: freeForm.slug,
        contact: { email, firstName, lastName },
        profile: { businessName: `${firstName} ${TAG} Co` },
        answers: {},
        acceptances: acceptances(),
      });

  beforeAll(async () => {
    await prisma.organization.deleteMany({ where: { name: { startsWith: `${TAG} ` } } }).catch(() => {});
    adminToken = await staffToken({ email: staffEmails[0], role: 'ADMIN' });
    org = await prisma.organization.create({ data: { name: `${TAG} Org`, email: `owner@${TAG}.test` } });
    await joinOrgByToken(adminToken, org.id, 'ADMIN');
    const venue = await prisma.venue.create({ data: { organizationId: org.id, name: `${TAG} Hall`, address: '1 Main', city: 'Raleigh', state: 'NC' } });
    const future = new Date(Date.now() + 30 * 24 * 3600 * 1000);
    event = await prisma.event.create({ data: { venueId: venue.id, name: `${TAG} Show`, date: future, capacity: 100, status: 'PUBLISHED' } });
    rsvpEvent = await prisma.event.create({ data: { venueId: venue.id, name: `${TAG} Meetup`, date: future, capacity: 0, status: 'PUBLISHED', admissionMode: 'RSVP' } });
    tier = await prisma.priceTier.create({ data: { eventId: event.id, name: 'GA', price: 10, quantityTotal: 50 } });

    const f = await request(app)
      .post(`/admin/events/${event.id}/application-forms`)
      .set(...auth(adminToken))
      .send({ kind: 'FREE', name: 'Press', questions: [] });
    expect(f.status).toBe(201);
    freeForm = f.body;
    const opened = await request(app)
      .patch(`/admin/events/${event.id}/application-forms/${freeForm.id}`)
      .set(...auth(adminToken))
      .send({ status: 'OPEN' });
    expect(opened.status).toBe(200);
  });

  afterAll(async () => {
    const eventIds = [event?.id, rsvpEvent?.id].filter(Boolean);
    await prisma.legalAcceptance.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.eventRsvp.deleteMany({ where: { eventId: { in: eventIds } } }).catch(() => {});
    await prisma.ticket.deleteMany({ where: { eventId: { in: eventIds } } }).catch(() => {});
    await prisma.paymentTransaction.deleteMany({ where: { order: { eventId: { in: eventIds } } } }).catch(() => {});
    await prisma.orderItem.deleteMany({ where: { order: { eventId: { in: eventIds } } } }).catch(() => {});
    await prisma.order.deleteMany({ where: { eventId: { in: eventIds } } }).catch(() => {});
    await prisma.application.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.applicantProfile.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.applicationForm.deleteMany({ where: { eventId: { in: eventIds } } }).catch(() => {});
    await prisma.buyerLoginToken.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.priceTier.deleteMany({ where: { eventId: { in: eventIds } } }).catch(() => {});
    await prisma.contact.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.event.deleteMany({ where: { id: { in: eventIds } } }).catch(() => {});
    await prisma.venue.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.organization.deleteMany({ where: { id: org.id } }).catch(() => {});
    await cleanupStaff(staffEmails);
  });

  // ─── C3: normalization ─────────────────────────────────────────────────────

  it('checkout keys the Contact on the trimmed, lower-cased email', async () => {
    const res = await checkout(`  Mixed.Case@${TAG.toUpperCase()}.TEST `, 'Mia', 'Mixed');
    expect(res.status).toBe(201);
    const again = await checkout(`mixed.case@${TAG}.test`, 'Mia', 'Mixed');
    expect(again.status).toBe(201);

    const rows = await contactsLike('mixed.case');
    expect(rows.map((c) => c.email)).toEqual([`mixed.case@${TAG}.test`]);
    const orders = await prisma.order.findMany({ where: { contactId: rows[0].id } });
    expect(orders).toHaveLength(2);
  });

  it('guest order lookup and buyer sign-in find the Contact whatever the spacing or case', async () => {
    const created = await checkout(`lookup@${TAG}.test`, 'Lou', 'Lookup');
    expect(created.status).toBe(201);
    const lookup = await request(app)
      .post('/orders/lookup')
      .send({ email: ` LOOKUP@${TAG}.test `, orderRef: created.body.orderRef });
    expect(lookup.status).toBe(200);

    await prisma.contact.update({ where: { organizationId_email: { organizationId: org.id, email: `lookup@${TAG}.test` } }, data: { accountCreatedAt: new Date() } });
    const signIn = await buyerAuthService.requestLogin(org.id, `  Lookup@${TAG}.TEST`);
    expect(signIn.issued).toBe(true);
  });

  it('application submit and RSVP reuse the same normalized Contact', async () => {
    const res = await apply(` Shared@${TAG}.Test`, 'Sam', 'Shared');
    expect(res.status).toBe(201);
    const rsvp = await request(app)
      .post(`/events/${rsvpEvent.id}/rsvps`)
      .send({ email: `SHARED@${TAG}.TEST  `, firstName: 'Sam', lastName: 'Shared', acceptances: acceptances() });
    expect(rsvp.status).toBe(202);

    const rows = await contactsLike('shared@');
    expect(rows.map((c) => c.email)).toEqual([`shared@${TAG}.test`]);
    expect(await prisma.application.count({ where: { contactId: rows[0].id } })).toBe(1);
    expect(await prisma.eventRsvp.count({ where: { contactId: rows[0].id } })).toBe(1);
  });

  // ─── C4 / D12: fill blanks only ────────────────────────────────────────────

  it('a second checkout on the same email never renames the Contact', async () => {
    expect((await checkout(`family@${TAG}.test`, 'Alice', 'Original')).status).toBe(201);
    expect((await checkout(`family@${TAG}.test`, 'Bob', 'Other')).status).toBe(201);
    const contact = await contactOf(`family@${TAG}.test`);
    expect(contact).toMatchObject({ firstName: 'Alice', lastName: 'Original' });
  });

  it('checkout fills in a missing name', async () => {
    await prisma.contact.create({ data: { organizationId: org.id, email: `blank@${TAG}.test`, firstName: '', lastName: 'Kept' } });
    expect((await checkout(`blank@${TAG}.test`, 'Filled', 'Replaced')).status).toBe(201);
    const contact = await contactOf(`blank@${TAG}.test`);
    expect(contact).toMatchObject({ firstName: 'Filled', lastName: 'Kept' });
  });

  it('application submit never overwrites an existing name and fills a missing one', async () => {
    await prisma.contact.create({ data: { organizationId: org.id, email: `vendor@${TAG}.test`, firstName: 'Vera', lastName: 'Vendor' } });
    expect((await apply(`vendor@${TAG}.test`, 'Someone', 'Else')).status).toBe(201);
    expect(await contactOf(`vendor@${TAG}.test`)).toMatchObject({ firstName: 'Vera', lastName: 'Vendor' });

    await prisma.contact.create({ data: { organizationId: org.id, email: `nameless@${TAG}.test`, firstName: '', lastName: '' } });
    expect((await apply(`nameless@${TAG}.test`, 'Nia', 'Named')).status).toBe(201);
    expect(await contactOf(`nameless@${TAG}.test`)).toMatchObject({ firstName: 'Nia', lastName: 'Named' });
  });

  // ─── C1 / D13: ticket attendee edit ────────────────────────────────────────

  describe('PATCH /admin/tickets/:ticketId/attendee', () => {
    let seq = 0;
    async function paidOrder(email, tickets) {
      seq += 1;
      const contact = await prisma.contact.create({ data: { organizationId: org.id, email, firstName: 'Tess', lastName: 'Ticket' } });
      const order = await prisma.order.create({
        data: { eventId: event.id, contactId: contact.id, orderRef: `${TAG.toUpperCase()}-T${seq}`, totalAmount: 10 * tickets, quantity: tickets, status: 'COMPLETED', paidAt: new Date() },
      });
      const ticketRows = [];
      for (let i = 0; i < tickets; i += 1) {
        ticketRows.push(await prisma.ticket.create({
          data: { orderId: order.id, eventId: event.id, priceTierId: tier.id, contactId: contact.id, ticketNumber: 9370000 + seq * 10 + i, pricePaid: 10, barcode: `${TAG}-${seq}-${i}` },
        }));
      }
      return { contact, order, tickets: ticketRows };
    }
    const patch = (ticketId, body) =>
      request(app).patch(`/admin/tickets/${ticketId}/attendee`).set(...auth(adminToken)).send(body);

    it('refuses an email change and leaves the Contact untouched', async () => {
      const { contact, tickets } = await paidOrder(`single@${TAG}.test`, 1);
      const res = await patch(tickets[0].id, { firstName: 'Tess', email: `hijack@${TAG}.test` });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('ATTENDEE_EMAIL_NOT_EDITABLE');
      const after = await prisma.contact.findUnique({ where: { id: contact.id } });
      expect(after.email).toBe(`single@${TAG}.test`);
    });

    it('updates the name when the order holds exactly one ticket', async () => {
      const { contact, tickets } = await paidOrder(`solo@${TAG}.test`, 1);
      const res = await patch(tickets[0].id, { firstName: ' Renamed ', lastName: 'Holder' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: contact.id, firstName: 'Renamed', lastName: 'Holder', email: `solo@${TAG}.test` });
    });

    it('refuses a name change on a multi-ticket order', async () => {
      const { contact, tickets } = await paidOrder(`group@${TAG}.test`, 2);
      const res = await patch(tickets[1].id, { firstName: 'Guest' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('ATTENDEE_EDIT_MULTI_TICKET_ORDER');
      const after = await prisma.contact.findUnique({ where: { id: contact.id } });
      expect(after.firstName).toBe('Tess');
    });
  });
});
