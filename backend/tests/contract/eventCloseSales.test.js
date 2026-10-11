// Contract tests for spec 050-D: unpublish, close / reopen sales, delete a draft.
// Each unpublish/delete guard (live order, GOING RSVP, submitted application),
// each SALES_CLOSED enforcement point (checkout, RSVP, application submit), the
// paths a close must leave alone (redeeming a sold ticket), idempotency, and
// the public payload. Stripe and Resend mocked; Postgres is real.

import { jest } from '@jest/globals';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const RUN = Date.now().toString(36);
let sessionN = 0;
jest.unstable_mockModule('../../src/config/stripe.js', () => ({
  default: {
    checkout: {
      sessions: {
        create: jest.fn(async (params) => {
          sessionN += 1;
          const id = `cs_close_${RUN}_${sessionN}`;
          return { id, url: `https://checkout.stripe.com/pay/${id}`, payment_intent: null, metadata: params.metadata };
        }),
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
jest.unstable_mockModule('../../src/config/resend.js', () => ({
  default: { emails: { send: jest.fn(async () => ({ id: 'mock' })) } },
}));

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');
const { staffToken, joinOrgByToken, cleanupStaff } = await import('../helpers/staff.js');
const { allAcceptances } = await import('../helpers/legal.js');

const TAG = `close-sales-${RUN}`;
const future = new Date(Date.now() + 120 * 24 * 60 * 60 * 1000);
const emails = [`admin@${TAG}.test`, `organizer@${TAG}.test`, `outsider@${TAG}.test`];

describe('Unpublish, close sales and delete draft (spec 050-D)', () => {
  let adminToken;
  let organizerToken;
  let outsiderToken;
  let adminId;
  let org;
  let venue;
  let n = 0;

  const auth = (t = adminToken) => ['Authorization', `Bearer ${t}`];
  const base = (id) => `/organizations/${org.id}/events/${id}`;
  const act = (id, action, t) => request(app).post(`${base(id)}/${action}`).set(...auth(t)).send({});

  /** A fresh event (TICKETED with one tier unless told otherwise). */
  const mkEvent = async (data = {}) => {
    n += 1;
    const rsvp = data.admissionMode === 'RSVP';
    return prisma.event.create({
      data: {
        venueId: venue.id,
        name: `Event ${n} ${TAG}`,
        slug: `event-${n}-${TAG}`,
        date: future,
        capacity: rsvp ? 0 : 50,
        status: 'PUBLISHED',
        ...(rsvp ? { rsvpLimit: 20 } : { priceTiers: { create: { name: 'GA', price: 10, quantityTotal: 50 } } }),
        ...data,
      },
      include: { priceTiers: true },
    });
  };
  const mkContact = (label) =>
    prisma.contact.create({ data: { organizationId: org.id, email: `${label}-${n}@${TAG}.test`, firstName: 'Ann', lastName: 'Buyer' } });
  const mkOrder = async (event, status) => {
    const contact = await mkContact(`order-${status}`);
    return prisma.order.create({
      data: { organizationId: org.id, eventId: event.id, contactId: contact.id, orderRef: `CS-${RUN}-${n}-${status}`, totalAmount: 10, quantity: 1, status },
    });
  };
  const mkForm = (event, status = 'OPEN') =>
    prisma.applicationForm.create({
      data: { organizationId: org.id, eventId: event.id, kind: 'FREE', name: 'Press', slug: `press-${n}`, status },
    });
  const mkApplication = async (event, status) => {
    const form = await mkForm(event);
    const contact = await mkContact(`app-${status}`);
    return prisma.application.create({
      data: { formId: form.id, eventId: event.id, organizationId: org.id, contactId: contact.id, status, statusTokenHash: `hash-${TAG}-${n}-${status}` },
    });
  };
  const checkout = (event) =>
    request(app)
      .post('/orders')
      .send({ eventId: event.id, items: [{ priceTierId: event.priceTiers[0].id, quantity: 1 }], contact: { email: `buyer-${n}@${TAG}.test`, firstName: 'Bea', lastName: 'Buyer' } });
  const rsvp = (event, email = `guest-${n}@${TAG}.test`) =>
    request(app).post(`/events/${event.id}/rsvps`).send({ firstName: 'Rita', lastName: 'Guest', email, partySize: 1, marketing: false });

  beforeAll(async () => {
    adminToken = await staffToken({ role: 'ADMIN', email: emails[0] });
    organizerToken = await staffToken({ role: 'ORGANIZER', email: emails[1] });
    outsiderToken = await staffToken({ role: 'ADMIN', email: emails[2] });
    adminId = jwt.decode(adminToken).sub;
    org = await prisma.organization.create({ data: { name: `Close Sales Org ${TAG}` } });
    await joinOrgByToken(adminToken, org.id, 'ADMIN');
    await joinOrgByToken(organizerToken, org.id, 'ORGANIZER');
    venue = await prisma.venue.create({
      data: { organizationId: org.id, name: 'Close Hall', address: '1 Main St', timezone: 'America/New_York' },
    });
  });

  afterAll(async () => {
    const eventIds = (await prisma.event.findMany({ where: { venueId: venue.id }, select: { id: true } })).map((e) => e.id);
    const eventWhere = { eventId: { in: eventIds } };
    await prisma.legalAcceptance.deleteMany({ where: { organizationId: org.id } });
    await prisma.ticket.deleteMany({ where: eventWhere });
    await prisma.orderItem.deleteMany({ where: { order: eventWhere } });
    await prisma.paymentTransaction.deleteMany({ where: { order: eventWhere } });
    await prisma.order.deleteMany({ where: { organizationId: org.id } });
    await prisma.application.deleteMany({ where: { organizationId: org.id } });
    await prisma.eventRsvp.deleteMany({ where: eventWhere });
    await prisma.applicationForm.deleteMany({ where: { organizationId: org.id } });
    await prisma.priceTier.deleteMany({ where: eventWhere });
    await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
    await prisma.applicantProfile.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.contact.deleteMany({ where: { organizationId: org.id } });
    await prisma.venue.delete({ where: { id: venue.id } });
    await prisma.organization.delete({ where: { id: org.id } });
    await cleanupStaff(emails);
  });

  describe('close and reopen sales', () => {
    it('closes a published event, records who, and is idempotent', async () => {
      const event = await mkEvent();
      const first = await act(event.id, 'close-sales');
      expect(first.status).toBe(200);
      expect(first.body).toMatchObject({ status: 'PUBLISHED', salesClosed: true });
      expect(first.body.salesClosedAt).toBeTruthy();
      const again = await act(event.id, 'close-sales');
      expect(again.status).toBe(200);
      expect(again.body.salesClosedAt).toBe(first.body.salesClosedAt);
      const row = await prisma.event.findUnique({ where: { id: event.id } });
      expect(row.salesClosedById).toBe(adminId);

      const reopened = await act(event.id, 'reopen-sales');
      expect(reopened.status).toBe(200);
      expect(reopened.body).toMatchObject({ salesClosed: false, salesClosedAt: null });
      expect((await act(event.id, 'reopen-sales')).body.salesClosed).toBe(false);
      expect((await prisma.event.findUnique({ where: { id: event.id } })).salesClosedById).toBeNull();
    });

    it('is PUBLISHED only (409 on a draft or a cancelled event)', async () => {
      const draft = await mkEvent({ status: 'DRAFT' });
      const cancelled = await mkEvent({ status: 'CANCELLED' });
      expect((await act(draft.id, 'close-sales')).status).toBe(409);
      expect((await act(draft.id, 'reopen-sales')).status).toBe(409);
      expect((await act(cancelled.id, 'close-sales')).status).toBe(409);
    });

    it('uses the publish/cancel guard: any org staff, never an outsider', async () => {
      const event = await mkEvent();
      expect((await act(event.id, 'close-sales', organizerToken)).status).toBe(200);
      expect((await act(event.id, 'reopen-sales', outsiderToken)).status).toBe(403);
      expect((await request(app).post(`${base(event.id)}/close-sales`).send({})).status).toBe(401);
    });

    it('the public payload carries salesClosed; the admin list shows it', async () => {
      const event = await mkEvent();
      await act(event.id, 'close-sales');
      const pub = await request(app).get(`/events/${event.id}`);
      expect(pub.status).toBe(200);
      expect(pub.body.salesClosed).toBe(true);
      expect(pub.body.salesClosedAt).toBeUndefined();
      const list = await request(app).get(`/organizations/${org.id}/events?q=${encodeURIComponent(event.name)}`).set(...auth());
      expect(list.body.events.find((e) => e.id === event.id)?.salesClosed).toBe(true);
    });
  });

  describe('SALES_CLOSED enforcement', () => {
    it('refuses a ticket checkout, and reopening restores it', async () => {
      const event = await mkEvent();
      await act(event.id, 'close-sales');
      const refused = await checkout(event);
      expect(refused.status).toBe(409);
      expect(refused.body.code).toBe('SALES_CLOSED');
      const tier = await prisma.priceTier.findUnique({ where: { id: event.priceTiers[0].id } });
      expect(tier.quantityReserved).toBe(0);

      await act(event.id, 'reopen-sales');
      expect((await checkout(event)).status).toBe(201);
    });

    it('refuses a new RSVP, and reopening restores it', async () => {
      const event = await mkEvent({ admissionMode: 'RSVP' });
      await act(event.id, 'close-sales');
      const refused = await rsvp(event);
      expect(refused.status).toBe(409);
      expect(refused.body.code).toBe('SALES_CLOSED');
      await act(event.id, 'reopen-sales');
      expect((await rsvp(event)).status).toBe(202);
    });

    it('refuses an application submission and reports the forms closed', async () => {
      const event = await mkEvent();
      const form = await mkForm(event);
      await act(event.id, 'close-sales');
      const forms = await request(app).get(`/events/${event.id}/applications/forms`);
      expect(forms.body.data[0].acceptance).toEqual({ open: false, reason: 'sales_closed' });

      const submit = () =>
        request(app)
          .post(`/events/${event.id}/applications`)
          .send({
            formSlug: form.slug,
            contact: { email: `applicant-${n}@${TAG}.test`, firstName: 'Pat', lastName: 'Press' },
            acceptances: allAcceptances(),
            profile: { businessName: 'Retro Weekly' },
            answers: {},
          });
      const refused = await submit();
      expect(refused.status).toBe(409);
      expect(refused.body.code).toBe('SALES_CLOSED');

      await act(event.id, 'reopen-sales');
      expect((await submit()).status).toBe(201);
    });

    it('never touches door scanning: a sold ticket still redeems', async () => {
      const event = await mkEvent();
      const order = await mkOrder(event, 'COMPLETED');
      const ticket = await prisma.ticket.create({
        data: { orderId: order.id, eventId: event.id, priceTierId: event.priceTiers[0].id, contactId: order.contactId, ticketNumber: 1, pricePaid: 10, barcode: `JUMP-CS-${RUN}` },
      });
      await act(event.id, 'close-sales');
      const qrPayload = jwt.sign({ sub: ticket.id, eventId: event.id, barcode: ticket.barcode }, process.env.AUTH_SECRET, { algorithm: 'HS256', expiresIn: '2d' });
      const res = await request(app).post('/tickets/redeem').set(...auth()).send({ qrPayload });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('REDEEMED');
    });
  });

  describe('unpublish', () => {
    it('turns a clean published event into a draft, clears the close, and the public page 404s', async () => {
      const event = await mkEvent();
      await mkOrder(event, 'FAILED');
      await mkOrder(event, 'CANCELLED');
      await act(event.id, 'close-sales');
      const res = await act(event.id, 'unpublish');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'DRAFT', salesClosed: false, salesClosedAt: null });
      expect((await request(app).get(`/events/${event.id}`)).status).toBe(404);
      expect((await act(event.id, 'unpublish')).status).toBe(409);
    });

    it.each([
      ['a live order', (e) => mkOrder(e, 'PENDING'), /1 order/],
      ['a GOING RSVP', async (e) => prisma.eventRsvp.create({ data: { eventId: e.id, contactId: (await mkContact('rsvp')).id } }), /1 RSVP/],
      ['a submitted application', (e) => mkApplication(e, 'SUBMITTED'), /1 submitted application/],
    ])('is refused with reasons for %s', async (_label, seed, reason) => {
      const event = await mkEvent();
      await seed(event);
      const res = await act(event.id, 'unpublish');
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('UNPUBLISH_BLOCKED');
      expect(res.body.details.reasons).toEqual([expect.stringMatching(reason)]);
      expect((await prisma.event.findUnique({ where: { id: event.id } })).status).toBe('PUBLISHED');
    });

    it('ignores a cancelled RSVP and a draft application', async () => {
      const event = await mkEvent();
      await prisma.eventRsvp.create({ data: { eventId: event.id, contactId: (await mkContact('gone')).id, status: 'CANCELLED' } });
      await mkApplication(event, 'DRAFT');
      expect((await act(event.id, 'unpublish')).status).toBe(200);
    });
  });

  describe('delete draft', () => {
    const del = (id, t) => request(app).delete(base(id)).set(...auth(t));

    it('deletes a clean draft with its tiers, forms and abandoned rows', async () => {
      const event = await mkEvent({ status: 'DRAFT' });
      await mkApplication(event, 'DRAFT');
      const res = await del(event.id);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ deleted: true, id: event.id });
      expect(await prisma.event.findUnique({ where: { id: event.id } })).toBeNull();
      expect(await prisma.priceTier.count({ where: { eventId: event.id } })).toBe(0);
      expect(await prisma.applicationForm.count({ where: { eventId: event.id } })).toBe(0);
    });

    it('refuses a published event and another organization', async () => {
      const event = await mkEvent();
      expect((await del(event.id)).status).toBe(409);
      expect((await del(event.id, outsiderToken)).status).toBe(403);
    });

    it.each([
      ['a live order', (e) => mkOrder(e, 'PENDING'), /1 order/],
      ['a GOING RSVP', async (e) => prisma.eventRsvp.create({ data: { eventId: e.id, contactId: (await mkContact('rsvp-d')).id } }), /1 RSVP/],
      ['a submitted application', (e) => mkApplication(e, 'SUBMITTED'), /1 submitted application/],
      ['a failed checkout (money rows are never cascaded)', (e) => mkOrder(e, 'FAILED'), /1 past checkout/],
    ])('is refused with reasons for %s', async (_label, seed, reason) => {
      const event = await mkEvent({ status: 'DRAFT' });
      await seed(event);
      const res = await del(event.id);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('DELETE_BLOCKED');
      expect(res.body.details.reasons).toEqual([expect.stringMatching(reason)]);
      expect(await prisma.event.findUnique({ where: { id: event.id } })).not.toBeNull();
    });
  });
});
