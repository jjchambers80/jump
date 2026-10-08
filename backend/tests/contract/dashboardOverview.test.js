// Contract tests for GET /admin/dashboard/overview: the dashboard's trend,
// upcoming events, recent orders and attention queue, scoped to the active
// organization. Fixtures are written straight to Postgres.

import { jest } from '@jest/globals';
import request from 'supertest';
import { createHash } from 'node:crypto';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';

jest.unstable_mockModule('../../src/config/resend.js', () => ({
  default: { emails: { send: jest.fn(async () => ({ id: 'mock' })) } },
}));

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');
const { dayKey, lastDays, safeTimeZone } = await import('../../src/services/DashboardService.js');

const TAG = 'dashov';
const auth = (token) => ['Authorization', `Bearer ${token}`];
const sha = (s) => createHash('sha256').update(s).digest('hex');
const DAY = 86_400_000;
const ago = (days) => new Date(Date.now() - days * DAY);
const ahead = (days) => new Date(Date.now() + days * DAY);

describe('Dashboard overview contract', () => {
  let token;
  let org;
  let otherOrg;
  const events = {};
  const emails = [`admin@${TAG}.test`];
  let seq = 0;

  async function order(event, tier, contact, { status = 'COMPLETED', total, tickets = 1, createdAt = new Date() }) {
    seq += 1;
    return prisma.order.create({
      data: {
        eventId: event.id,
        contactId: contact.id,
        orderRef: `${TAG.toUpperCase()}-${seq}`,
        totalAmount: total,
        subtotalAmount: total,
        quantity: tickets,
        status,
        createdAt,
        items: { create: { priceTierId: tier.id, quantity: tickets, unitPrice: total / tickets } },
      },
    });
  }

  beforeAll(async () => {
    await prisma.organization.deleteMany({ where: { name: { startsWith: `${TAG} ` } } }).catch(() => {});
    token = await staffToken({ email: emails[0], role: 'ADMIN' });
    org = await prisma.organization.create({ data: { name: `${TAG} Org`, email: `owner@${TAG}.test` } });
    otherOrg = await prisma.organization.create({ data: { name: `${TAG} Other`, email: `other@${TAG}.test` } });
    await joinOrgByToken(token, org.id, 'ADMIN');

    const venue = await prisma.venue.create({ data: { organizationId: org.id, name: `${TAG} Hall`, address: '1 Main', city: 'Raleigh', state: 'NC', timezone: 'America/New_York' } });
    const otherVenue = await prisma.venue.create({ data: { organizationId: otherOrg.id, name: `${TAG} Elsewhere`, address: '2 Main', city: 'Austin', state: 'TX' } });
    const ev = (data) => prisma.event.create({ data: { venueId: venue.id, capacity: 100, ...data } });
    events.soon = await ev({ name: `${TAG} Soon`, date: ahead(3), status: 'PUBLISHED' });
    events.later = await ev({ name: `${TAG} Later`, date: ahead(20), status: 'PUBLISHED', admissionMode: 'RSVP', rsvpLimit: 40 });
    events.draft = await ev({ name: `${TAG} Draft`, date: ahead(10), status: 'DRAFT' });
    events.cancelled = await ev({ name: `${TAG} Cancelled`, date: ahead(5), status: 'CANCELLED' });
    events.past = await ev({ name: `${TAG} Past`, date: ago(2), status: 'PUBLISHED' });
    events.foreign = await prisma.event.create({ data: { venueId: otherVenue.id, name: `${TAG} Foreign`, date: ahead(1), status: 'PUBLISHED', capacity: 10 } });

    const tier = await prisma.priceTier.create({ data: { eventId: events.soon.id, name: 'GA', price: 20, quantityTotal: 50, quantitySold: 3 } });
    await prisma.priceTier.create({ data: { eventId: events.soon.id, name: 'VIP', price: 60, quantityTotal: 10, quantitySold: 1 } });
    const pastTier = await prisma.priceTier.create({ data: { eventId: events.past.id, name: 'GA', price: 10, quantityTotal: 10, quantitySold: 1 } });
    const foreignTier = await prisma.priceTier.create({ data: { eventId: events.foreign.id, name: 'GA', price: 99, quantityTotal: 10, quantitySold: 1 } });

    const buyer = await prisma.contact.create({ data: { organizationId: org.id, email: `buyer@${TAG}.test`, firstName: 'Bea', lastName: 'Buyer' } });
    const guest = await prisma.contact.create({ data: { organizationId: org.id, email: `guest@${TAG}.test`, firstName: 'Gil', lastName: 'Guest' } });
    const outsider = await prisma.contact.create({ data: { organizationId: otherOrg.id, email: `out@${TAG}.test`, firstName: 'Out', lastName: 'Sider' } });

    await order(events.soon, tier, buyer, { total: 40, tickets: 2, createdAt: new Date() });
    await order(events.past, pastTier, guest, { total: 10, createdAt: ago(3) });
    await order(events.soon, tier, guest, { status: 'PENDING', total: 20, createdAt: new Date() });
    await order(events.soon, tier, buyer, { total: 500, createdAt: ago(30) }); // outside the trend window
    await order(events.foreign, foreignTier, outsider, { total: 99, createdAt: new Date() });

    await prisma.eventRsvp.create({ data: { eventId: events.later.id, contactId: buyer.id, partySize: 3 } });
    await prisma.eventRsvp.create({ data: { eventId: events.later.id, contactId: guest.id, partySize: 2, status: 'CANCELLED' } });

    const form = await prisma.applicationForm.create({ data: { organizationId: org.id, eventId: events.soon.id, kind: 'FREE', name: 'Vendors', slug: `${TAG}-vendors`, status: 'OPEN' } });
    for (const [i, status] of ['SUBMITTED', 'SUBMITTED', 'APPROVED'].entries()) {
      const contact = await prisma.contact.create({ data: { organizationId: org.id, email: `app${i}@${TAG}.test`, firstName: 'App', lastName: `${i}` } });
      await prisma.application.create({ data: { formId: form.id, eventId: events.soon.id, organizationId: org.id, contactId: contact.id, status, submittedAt: new Date(), statusTokenHash: sha(`${TAG}-${i}`) } });
    }
  });

  afterAll(async () => {
    const orgIds = [org.id, otherOrg.id];
    await prisma.application.deleteMany({ where: { organizationId: { in: orgIds } } }).catch(() => {});
    await prisma.applicationForm.deleteMany({ where: { organizationId: { in: orgIds } } }).catch(() => {});
    await prisma.eventRsvp.deleteMany({ where: { event: { venue: { organizationId: { in: orgIds } } } } }).catch(() => {});
    await prisma.orderItem.deleteMany({ where: { order: { event: { venue: { organizationId: { in: orgIds } } } } } }).catch(() => {});
    await prisma.order.deleteMany({ where: { event: { venue: { organizationId: { in: orgIds } } } } }).catch(() => {});
    await prisma.priceTier.deleteMany({ where: { event: { venue: { organizationId: { in: orgIds } } } } }).catch(() => {});
    await prisma.event.deleteMany({ where: { venue: { organizationId: { in: orgIds } } } }).catch(() => {});
    await prisma.contact.deleteMany({ where: { organizationId: { in: orgIds } } }).catch(() => {});
    await prisma.venue.deleteMany({ where: { organizationId: { in: orgIds } } }).catch(() => {});
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } }).catch(() => {});
    await cleanupStaff(emails);
  });

  it('builds a 14-day trend in the viewer zone from paid orders of the active org only', async () => {
    const res = await request(app).get('/admin/dashboard/overview?tz=America/New_York').set(...auth(token));
    expect(res.status).toBe(200);
    expect(res.body.timeZone).toBe('America/New_York');
    expect(res.body.trend).toHaveLength(14);
    const today = res.body.trend.at(-1);
    expect(today.date).toBe(dayKey(new Date(), 'America/New_York'));
    expect(today).toMatchObject({ revenue: 40, orders: 1, tickets: 2 }); // pending + foreign excluded
    expect(res.body.trend.reduce((sum, d) => sum + d.revenue, 0)).toBe(50); // 30-day-old order outside the window
  });

  it('lists upcoming non-cancelled events with tier or RSVP fill', async () => {
    const res = await request(app).get('/admin/dashboard/overview').set(...auth(token));
    expect(res.body.upcoming.map((e) => e.name)).toEqual([`${TAG} Soon`, `${TAG} Draft`, `${TAG} Later`]);
    expect(res.body.upcoming[0]).toMatchObject({ sold: 4, capacity: 60, admissionMode: 'TICKETED', venueName: `${TAG} Hall`, timezone: 'America/New_York' });
    expect(res.body.upcoming[2]).toMatchObject({ sold: 3, capacity: 40, admissionMode: 'RSVP' });
  });

  it('returns recent paid orders newest first and the attention queue', async () => {
    const res = await request(app).get('/admin/dashboard/overview').set(...auth(token));
    expect(res.body.recentOrders.map((o) => o.total)).toEqual([40, 10, 500]);
    expect(res.body.recentOrders[0]).toMatchObject({ buyer: 'Bea Buyer', eventName: `${TAG} Soon`, kind: 'TICKET', quantity: 2 });
    expect(res.body.attention.draftEvents.map((e) => e.name)).toEqual([`${TAG} Draft`]);
    expect(res.body.attention.applicationsToReview).toEqual([{ eventId: events.soon.id, formId: null, name: `${TAG} Soon`, count: 2 }]);
  });

  it('falls back to UTC for an unknown zone and keeps day keys unique across DST', () => {
    expect(safeTimeZone('Not/AZone')).toBe('UTC');
    const days = lastDays(new Date('2026-11-10T12:00:00Z'), 'America/New_York');
    expect(days).toHaveLength(14);
    expect(days[0]).toBe('2026-10-28');
    expect(days.at(-1)).toBe('2026-11-10');
  });
});
