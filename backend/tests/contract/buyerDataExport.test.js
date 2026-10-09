// Contract tests for "Download my data" (spec 040 card C): the buyer's own
// export and the staff export, scoped to one Contact at one organization,
// without secrets, capped per day and recorded on the customer timeline.

import { jest } from '@jest/globals';
import request from 'supertest';

jest.unstable_mockModule('../../src/config/resend.js', () => ({
  default: { emails: { send: jest.fn(async () => ({ id: 'mock' })) } },
}));

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');
const { default: buyerAuthService } = await import('../../src/services/BuyerAuthService.js');
const { staffToken, joinOrgByToken, cleanupStaff } = await import('../helpers/staff.js');

const TAG = 'data-export-040';
const EMAIL = `ada@${TAG}.test`;
const staffEmails = [`admin@${TAG}.test`, `organizer@${TAG}.test`];

async function createOrg(name) {
  const org = await prisma.organization.create({ data: { name, slug: `${TAG}-${name.toLowerCase().replace(/\W+/g, '-')}-${Date.now()}` } });
  const venue = await prisma.venue.create({ data: { organizationId: org.id, name: `${name} Hall`, address: '1 St', timezone: 'America/Chicago' } });
  const event = await prisma.event.create({
    data: { venueId: venue.id, name: `${name} Fair`, date: new Date(Date.now() + 7 * 86400000), capacity: 100, status: 'PUBLISHED' },
  });
  const tier = await prisma.priceTier.create({ data: { eventId: event.id, name: 'GA', price: 20, quantityTotal: 50 } });
  return { org, venue, event, tier };
}

async function seedBuyer(fixture, { note = null } = {}) {
  const contact = await prisma.contact.create({
    data: { organizationId: fixture.org.id, email: EMAIL, firstName: 'Ada', lastName: 'Lovelace', phone: '+19195550100', accountCreatedAt: new Date(), note, tags: note ? ['vip'] : [] },
  });
  const order = await prisma.order.create({
    data: {
      eventId: fixture.event.id,
      organizationId: contact.organizationId, contactId: contact.id,
      orderRef: `X040-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      quantity: 1,
      subtotalAmount: 20,
      totalAmount: 22.5,
      status: 'COMPLETED',
      paidAt: new Date(),
      stripeSessionId: `cs_secret_${Math.random().toString(36).slice(2)}`,
      items: { create: [{ priceTierId: fixture.tier.id, description: 'GA', quantity: 1, unitPrice: 20 }] },
      payment: { create: { amount: 22.5, currency: 'usd', status: 'SUCCEEDED', stripePaymentIntentId: `pi_secret_${Math.random().toString(36).slice(2)}` } },
    },
  });
  await prisma.ticket.create({
    data: { orderId: order.id, eventId: fixture.event.id, priceTierId: fixture.tier.id, contactId: contact.id, ticketNumber: 1, pricePaid: 20, barcode: `BC${TAG}${Math.random().toString(36).slice(2)}`, qrCodeJwt: 'jwt.secret.qr' },
  });
  await prisma.eventRsvp.create({ data: { eventId: fixture.event.id, contactId: contact.id, partySize: 2 } });
  await prisma.legalAcceptance.create({
    data: { subjectType: 'CONTACT', subjectId: contact.id, email: EMAIL, organizationId: fixture.org.id, document: 'MARKETING', version: '2026-09-29', source: 'ACCOUNT', presentedText: 'Email me news' },
  });
  if (note) {
    await prisma.contactComment.create({ data: { contactId: contact.id, organizationId: fixture.org.id, authorUserId: null, kind: 'COMMENT', body: 'Staff: asked for a refund by phone' } });
  }
  const token = buyerAuthService.signSession({ contactId: contact.id, organizationId: fixture.org.id, email: EMAIL });
  return { contact, order, auth: { Authorization: `Bearer ${token}` } };
}

describe('Download my data (spec 040 card C)', () => {
  let A;
  let B;
  let buyerA;
  let buyerB;
  let adminToken;
  let organizerToken;

  beforeAll(async () => {
    A = await createOrg(`${TAG} A`);
    B = await createOrg(`${TAG} B`);
    buyerA = await seedBuyer(A, { note: 'Prefers aisle seats' });
    buyerB = await seedBuyer(B); // same email, other organization
    adminToken = await staffToken({ email: staffEmails[0], role: 'ADMIN' });
    organizerToken = await staffToken({ email: staffEmails[1], role: 'ORGANIZER' });
    await joinOrgByToken(adminToken, A.org.id, 'ADMIN');
    await joinOrgByToken(organizerToken, A.org.id, 'ORGANIZER');
  });

  afterAll(async () => {
    const orgIds = [A?.org.id, B?.org.id].filter(Boolean);
    const contactWhere = { organizationId: { in: orgIds } };
    await prisma.legalAcceptance.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.ticket.deleteMany({ where: { contact: contactWhere } });
    await prisma.paymentTransaction.deleteMany({ where: { order: { contact: contactWhere } } });
    await prisma.orderItem.deleteMany({ where: { order: { contact: contactWhere } } });
    await prisma.order.deleteMany({ where: { contact: contactWhere } });
    await prisma.eventRsvp.deleteMany({ where: { contact: contactWhere } });
    await prisma.contactComment.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.contact.deleteMany({ where: contactWhere });
    await prisma.priceTier.deleteMany({ where: { event: { venue: { organizationId: { in: orgIds } } } } });
    await prisma.event.deleteMany({ where: { venue: { organizationId: { in: orgIds } } } });
    await prisma.venue.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.organizationMember.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    await cleanupStaff(staffEmails);
  });

  it('the buyer downloads a JSON attachment of this organization’s data only, with no secrets or staff notes', async () => {
    const res = await request(app).get('/buyer/me/export').set(buyerA.auth);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename=".+-my-data-\d{4}-\d{2}-\d{2}\.json"$/);
    expect(res.headers['cache-control']).toBe('no-store');

    const data = res.body;
    expect(data.format).toEqual({ name: 'jump-customer-data', version: 1 });
    expect(data.organization.id).toBe(A.org.id);
    expect(data.contact).toMatchObject({ id: buyerA.contact.id, email: EMAIL, phone: '+19195550100' });
    expect(data.orders).toHaveLength(1);
    expect(data.orders[0]).toMatchObject({ orderRef: buyerA.order.orderRef, total: 22.5, payment: { amount: 22.5, method: 'card' } });
    expect(data.tickets).toHaveLength(1);
    expect(data.rsvps).toHaveLength(1);
    expect(data.legalAcceptances).toEqual([expect.objectContaining({ document: 'MARKETING', source: 'ACCOUNT' })]);

    const text = JSON.stringify(data);
    expect(text).not.toContain(B.org.id);
    expect(text).not.toMatch(/pi_secret_|cs_secret_|jwt\.secret\.qr|tokenHash|"stripe[A-Za-z]*"/);
    expect(text).not.toContain('Prefers aisle seats');
    expect(text).not.toContain('Staff: asked');
    expect(data.contact.note).toBeUndefined();
    expect(data.staffTimeline).toBeUndefined();

    const logged = await prisma.contactComment.findFirst({ where: { contactId: buyerA.contact.id, kind: 'DATA_EXPORTED' } });
    expect(logged).toMatchObject({ authorUserId: null, body: 'Customer downloaded their data' });
  });

  it('caps the buyer at 3 downloads a day', async () => {
    // One already made above; two more are fine, the fourth is refused.
    expect((await request(app).get('/buyer/me/export').set(buyerA.auth)).status).toBe(200);
    expect((await request(app).get('/buyer/me/export').set(buyerA.auth)).status).toBe(200);
    const refused = await request(app).get('/buyer/me/export').set(buyerA.auth);
    expect(refused.status).toBe(429);
    // Another organization's buyer (same email) has their own allowance.
    expect((await request(app).get('/buyer/me/export').set(buyerB.auth)).status).toBe(200);
  });

  it('staff (ADMIN) export includes staff notes and is logged with the author; ORGANIZER is refused; other orgs are 404', async () => {
    const res = await request(app).get(`/admin/customers/${buyerA.contact.id}/export`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/-customer-data-/);
    expect(res.body.contact).toMatchObject({ note: 'Prefers aisle seats', tags: ['vip'] });
    expect(res.body.staffTimeline.some((c) => c.body === 'Staff: asked for a refund by phone')).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/pi_secret_|jwt\.secret\.qr/);

    const staffLine = await prisma.contactComment.findFirst({ where: { contactId: buyerA.contact.id, kind: 'DATA_EXPORTED', authorUserId: { not: null } } });
    expect(staffLine).toBeTruthy();

    expect((await request(app).get(`/admin/customers/${buyerA.contact.id}/export`).set('Authorization', `Bearer ${organizerToken}`)).status).toBe(403);
    expect((await request(app).get(`/admin/customers/${buyerB.contact.id}/export`).set('Authorization', `Bearer ${adminToken}`)).status).toBe(404);
  });

  it('needs a buyer session', async () => {
    expect((await request(app).get('/buyer/me/export')).status).toBe(401);
  });
});
