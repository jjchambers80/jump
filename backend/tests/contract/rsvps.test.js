import { jest } from '@jest/globals';
import request from 'supertest';

const sentEmails = [];
jest.unstable_mockModule('../../src/config/resend.js', () => ({
  default: { emails: { send: jest.fn(async (message) => { sentEmails.push(message); return { id: 'mock' }; }) } },
}));

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');
const { staffToken, joinOrgByToken } = await import('../helpers/staff.js');
const { cancelToken } = await import('../../src/services/rsvpLinks.js');
const { LEGAL_VERSIONS } = await import('../../src/config/legal.js');

const TAG = `rsvp-${Date.now()}`;
const future = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000);
const body = (email, extra = {}) => ({
  firstName: 'Rita', lastName: 'Guest', email, partySize: 1, marketing: false, ...extra,
});

describe('RSVP events contract', () => {
  let token;
  let otherToken;
  let org;
  let otherOrg;
  let venue;
  let rsvpEvent;
  let limitedEvent;
  let draftEvent;
  let pastEvent;
  let ticketedEvent;

  beforeAll(async () => {
    token = await staffToken({ role: 'ADMIN', email: `admin@${TAG}.test` });
    otherToken = await staffToken({ role: 'ADMIN', email: `other-admin@${TAG}.test` });
    org = await prisma.organization.create({ data: { name: `RSVP Org ${TAG}` } });
    otherOrg = await prisma.organization.create({ data: { name: `Other RSVP Org ${TAG}` } });
    await joinOrgByToken(token, org.id, 'ADMIN');
    await joinOrgByToken(otherToken, otherOrg.id, 'ADMIN');
    venue = await prisma.venue.create({
      data: { organizationId: org.id, name: 'RSVP Hall', address: '1 Main St', timezone: 'America/New_York' },
    });
    const createEvent = (data) => prisma.event.create({
      data: { venueId: venue.id, name: `${data.name} ${TAG}`, slug: `${data.slug}-${TAG}`, date: future, capacity: 0, admissionMode: 'RSVP', status: 'PUBLISHED', ...data },
    });
    rsvpEvent = await createEvent({ name: 'Open House', slug: 'open-house', rsvpLimit: 10, rsvpMaxPartySize: 4 });
    limitedEvent = await createEvent({ name: 'Limited', slug: 'limited', rsvpLimit: 1 });
    draftEvent = await createEvent({ name: 'Draft', slug: 'draft', status: 'DRAFT' });
    pastEvent = await createEvent({ name: 'Past', slug: 'past', date: new Date(Date.now() - 60_000) });
    ticketedEvent = await prisma.event.create({
      data: { venueId: venue.id, name: `Ticketed ${TAG}`, slug: `ticketed-${TAG}`, date: future, capacity: 10, status: 'PUBLISHED', admissionMode: 'TICKETED', priceTiers: { create: { name: 'GA', price: 10, quantityTotal: 10 } } },
      include: { priceTiers: true },
    });
  });

  afterAll(async () => {
    const eventIds = (await prisma.event.findMany({ where: { venueId: venue.id }, select: { id: true } })).map((e) => e.id);
    await prisma.legalAcceptance.deleteMany({ where: { organizationId: org.id } });
    await prisma.eventRsvp.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.orderItem.deleteMany({ where: { order: { eventId: { in: eventIds } } } });
    await prisma.order.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.priceTier.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.contact.deleteMany({ where: { organizationId: org.id } });
    await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
    await prisma.venue.delete({ where: { id: venue.id } });
    await prisma.organization.deleteMany({ where: { id: { in: [org.id, otherOrg.id] } } });
  });

  it('creates a contact, subscribes only on opt-in, and sends a zoned confirmation with ICS', async () => {
    sentEmails.length = 0;
    const email = `new@${TAG}.test`;
    await request(app).post(`/events/${rsvpEvent.id}/rsvps`).send(body(email, { marketing: true, partySize: 2 })).expect(202, { status: 'ok' });
    const contact = await prisma.contact.findUnique({ where: { organizationId_email: { organizationId: org.id, email } } });
    expect(contact).toMatchObject({ firstName: 'Rita', lastName: 'Guest', emailSubscribed: true, emailSubscribedSource: 'RSVP' });
    expect(sentEmails[0].text).toContain('EDT');
    expect(sentEmails[0].attachments[0].filename).toMatch(/\.ics$/);
  });

  it('enforces and records the current legal acceptances when required', async () => {
    process.env.LEGAL_ACCEPTANCE_REQUIRED = 'true';
    const email = `legal@${TAG}.test`;
    try {
      const refused = await request(app).post(`/events/${rsvpEvent.id}/rsvps`).send(body(email));
      expect(refused.status).toBe(400);
      expect(refused.body.code).toBe('LEGAL_ACCEPTANCE_REQUIRED');
      await request(app).post(`/events/${rsvpEvent.id}/rsvps`).send(body(email, {
        acceptances: [
          { document: 'TERMS', version: LEGAL_VERSIONS.terms },
          { document: 'PRIVACY', version: LEGAL_VERSIONS.privacy },
        ],
      })).expect(202);
      const rows = await prisma.legalAcceptance.findMany({ where: { email } });
      expect(rows).toHaveLength(2);
      expect(rows.every((row) => row.source === 'RSVP' && row.referenceType === 'EventRsvp')).toBe(true);
    } finally {
      delete process.env.LEGAL_ACCEPTANCE_REQUIRED;
    }
  });

  it('keeps an existing contact name, never unsubscribes, and updates duplicate party size identically', async () => {
    const email = `existing@${TAG}.test`;
    const contact = await prisma.contact.create({ data: { organizationId: org.id, email, firstName: 'Existing', lastName: 'Name', emailSubscribed: true, emailSubscribedSource: 'ADMIN', emailSubscribedAt: new Date() } });
    const first = await request(app).post(`/events/${rsvpEvent.id}/rsvps`).send(body(email, { firstName: 'Forged', lastName: 'Rename', partySize: 1 }));
    const second = await request(app).post(`/events/${rsvpEvent.id}/rsvps`).send(body(email, { partySize: 3 }));
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(second.body).toEqual(first.body);
    expect(await prisma.contact.findUnique({ where: { id: contact.id } })).toMatchObject({ firstName: 'Existing', lastName: 'Name', emailSubscribed: true, emailSubscribedSource: 'ADMIN' });
    expect(await prisma.eventRsvp.findUnique({ where: { eventId_contactId: { eventId: rsvpEvent.id, contactId: contact.id } } })).toMatchObject({ partySize: 3, status: 'GOING' });
  });

  it('refuses oversized, draft, past, and ticketed RSVPs', async () => {
    await request(app).post(`/events/${rsvpEvent.id}/rsvps`).send(body(`large@${TAG}.test`, { partySize: 5 })).expect(400);
    await request(app).post(`/events/${draftEvent.id}/rsvps`).send(body(`draft@${TAG}.test`)).expect(400);
    await request(app).post(`/events/${pastEvent.id}/rsvps`).send(body(`past@${TAG}.test`)).expect(400);
    await request(app).post(`/events/${ticketedEvent.id}/rsvps`).send(body(`ticketed@${TAG}.test`)).expect(409);
  });

  it('serializes the last spot under the event row lock', async () => {
    const responses = await Promise.all([
      request(app).post(`/events/${limitedEvent.id}/rsvps`).send(body(`race-a@${TAG}.test`)),
      request(app).post(`/events/${limitedEvent.id}/rsvps`).send(body(`race-b@${TAG}.test`)),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([202, 409]);
    expect(responses.find((r) => r.status === 409).body.code).toBe('RSVP_FULL');
  });

  it('cancels idempotently with a purpose-scoped token', async () => {
    const email = `cancel@${TAG}.test`;
    await request(app).post(`/events/${rsvpEvent.id}/rsvps`).send(body(email)).expect(202);
    const row = await prisma.eventRsvp.findFirst({ where: { eventId: rsvpEvent.id, contact: { email } } });
    const raw = cancelToken(row.id);
    await request(app).post('/rsvps/cancel').send({ token: raw }).expect(200, { status: 'ok' });
    await request(app).post('/rsvps/cancel').send({ token: raw }).expect(200, { status: 'ok' });
    expect(await prisma.eventRsvp.findUnique({ where: { id: row.id } })).toMatchObject({ status: 'CANCELLED' });
  });

  it('hides ticket inventory publicly and checkout refuses RSVP events', async () => {
    const detail = await request(app).get(`/events/${rsvpEvent.id}`).expect(200);
    expect(detail.body).toMatchObject({ admissionMode: 'RSVP', rsvpMaxPartySize: 4 });
    expect(detail.body.priceTiers).toEqual([]);
    const tier = await prisma.priceTier.create({ data: { eventId: rsvpEvent.id, name: 'Hidden', price: 0, quantityTotal: 5 } });
    const checkout = await request(app).post('/orders').send({ eventId: rsvpEvent.id, items: [{ priceTierId: tier.id, quantity: 1 }], contact: { email: `checkout@${TAG}.test`, firstName: 'C', lastName: 'Out' } });
    expect(checkout.status).toBe(409);
    expect(checkout.body.code).toBe('EVENT_NOT_TICKETED');
  });

  it('locks both admission-mode switch directions', async () => {
    const contact = await prisma.contact.create({ data: { organizationId: org.id, email: `order@${TAG}.test`, firstName: 'Order', lastName: 'Buyer' } });
    await prisma.order.create({ data: { eventId: ticketedEvent.id, contactId: contact.id, orderRef: `JMP-${Date.now().toString(36).toUpperCase().slice(-6).padStart(6, 'A')}`, totalAmount: 0, quantity: 1 } });
    const toRsvp = await request(app).patch(`/organizations/${org.id}/events/${ticketedEvent.id}`).set('Authorization', `Bearer ${token}`).send({ admissionMode: 'RSVP', rsvpLimit: 10 });
    expect(toRsvp.status).toBe(409);
    expect(toRsvp.body.code).toBe('ADMISSION_MODE_LOCKED');
    const toTicketed = await request(app).patch(`/organizations/${org.id}/events/${rsvpEvent.id}`).set('Authorization', `Bearer ${token}`).send({ admissionMode: 'TICKETED', capacity: 10 });
    expect(toTicketed.status).toBe(409);
    expect(toTicketed.body.code).toBe('ADMISSION_MODE_LOCKED');
  });

  it('lists and exports RSVPs only within the active organization', async () => {
    const list = await request(app).get(`/admin/events/${rsvpEvent.id}/rsvps`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(list.body.headcount).toBeGreaterThan(0);
    expect(list.body.data.length).toBeGreaterThan(0);
    const csv = await request(app).get(`/admin/events/${rsvpEvent.id}/rsvps?format=csv`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toContain('First name,Last name,Email');
    await request(app).get(`/admin/events/${rsvpEvent.id}/rsvps`).set('Authorization', `Bearer ${otherToken}`).expect(404);
  });

  it("filters RSVP'd contacts by organization and event without changing the default money list", async () => {
    const email = `filter@${TAG}.test`;
    await request(app).post(`/events/${rsvpEvent.id}/rsvps`).send(body(email)).expect(202);

    const defaultList = await request(app)
      .get(`/admin/customers?search=${encodeURIComponent(email)}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(defaultList.body.data).toHaveLength(0);

    const allRsvps = await request(app)
      .get(`/admin/customers?rsvp=going&search=${encodeURIComponent(email)}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(allRsvps.body.data.map((contact) => contact.email)).toEqual([email]);

    const eventRsvps = await request(app)
      .get(`/admin/customers?rsvp=going&eventId=${rsvpEvent.id}&search=${encodeURIComponent(email)}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(eventRsvps.body.data.map((contact) => contact.email)).toEqual([email]);

    const otherEvent = await request(app)
      .get(`/admin/customers?rsvp=going&eventId=${limitedEvent.id}&search=${encodeURIComponent(email)}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(otherEvent.body.data).toHaveLength(0);

    const foreign = await request(app)
      .get(`/admin/customers?rsvp=going&search=${encodeURIComponent(email)}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(200);
    expect(foreign.body.data).toHaveLength(0);

    const detail = await request(app)
      .get(`/admin/customers/${allRsvps.body.data[0].id}?rsvp=going&eventId=${rsvpEvent.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(detail.body.rsvps).toEqual([
      expect.objectContaining({
        partySize: 1,
        status: 'GOING',
        event: expect.objectContaining({ id: rsvpEvent.id }),
      }),
    ]);
  });

  it('keeps RSVPs out of orders and money analytics', async () => {
    expect(await prisma.order.count({ where: { eventId: rsvpEvent.id } })).toBe(0);
    const analytics = await request(app).get(`/organizations/${org.id}/events/${rsvpEvent.id}/analytics`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(analytics.body.revenue.net).toBe(0);
    expect(analytics.body.totals.revenue).toBe(0);
    expect(analytics.body.event).toMatchObject({ admissionMode: 'RSVP', rsvpLimit: 10 });
    expect(analytics.body.rsvp).toMatchObject({
      headcount: expect.any(Number),
      rsvpCount: expect.any(Number),
      cancelledCount: expect.any(Number),
    });
    expect(analytics.body.tiers).toEqual([]);
  });

  it('emails going guests and cancels their RSVPs when the event is cancelled', async () => {
    sentEmails.length = 0;
    await request(app).post(`/organizations/${org.id}/events/${rsvpEvent.id}/cancel`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(await prisma.eventRsvp.count({ where: { eventId: rsvpEvent.id, status: 'GOING' } })).toBe(0);
    expect(sentEmails.length).toBeGreaterThan(0);
    expect(sentEmails[0].html).toContain('Your RSVP has been cancelled');
  });
});
