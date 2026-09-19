// Contract tests: SYSTEM_ADMIN follows the org switcher.
//
// Every main-nav page shows one organization's data at a time. A SYSTEM_ADMIN
// has no memberships, so the X-Jump-Org header the admin switcher sends is
// the only thing that picks the active organization. Without it the role is
// unscoped (scripts, tooling); with it, lists and the door scanner are limited
// to that organization exactly like a member's would be.

import request from 'supertest';
import { prisma } from '@jump/db';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';

const { default: app } = await import('../../src/api/server.js');

const TAG = 'sysadmin-scope';
const SYS_EMAIL = `sys@${TAG}.test`;
const ADMIN_EMAIL = `admin@${TAG}.test`;

let ticketSeq = Math.floor(Math.random() * 100000);

async function seedOrg(adminToken, name) {
  const org = (await request(app).post('/organizations').set('Authorization', `Bearer ${adminToken}`).send({ name })).body;
  await joinOrgByToken(adminToken, org.id, 'ADMIN');
  const venue = (
    await request(app)
      .post(`/organizations/${org.id}/venues`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `${name} Hall`, address: '1 Main St', timezone: 'America/New_York' })
  ).body;
  const event = (
    await request(app)
      .post(`/organizations/${org.id}/events`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `${name} Show`,
        venueId: venue.id,
        date: '2026-12-31T20:00:00Z',
        capacity: 10,
        priceTiers: [{ name: 'GA', price: 1000, quantityTotal: 10, displayOrder: 1 }],
      })
  ).body;
  const contact = await prisma.contact.create({
    data: { organizationId: org.id, email: `buyer@${TAG}-${org.id}.test`, firstName: 'Buyer', lastName: name },
  });
  const order = await prisma.order.create({
    data: { eventId: event.id, contactId: contact.id, orderRef: `${TAG}-${org.id}`, totalAmount: 1000, quantity: 1, status: 'COMPLETED' },
  });
  const ticket = await prisma.ticket.create({
    data: {
      orderId: order.id,
      eventId: event.id,
      ticketNumber: (ticketSeq += 1),
      priceTierId: event.priceTiers[0].id,
      contactId: contact.id,
      pricePaid: 1000,
      barcode: `JUMP-${TAG.toUpperCase()}-${org.id.slice(-6).toUpperCase()}`,
      status: 'VALID',
    },
  });
  return { org, venue, event, contact, order, ticket };
}

describe('SYSTEM_ADMIN scoping via X-Jump-Org', () => {
  let sysToken, adminToken;
  let a, b;

  beforeAll(async () => {
    sysToken = await staffToken({ email: SYS_EMAIL, role: 'SYSTEM_ADMIN' });
    adminToken = await staffToken({ email: ADMIN_EMAIL, role: 'ADMIN' });
    a = await seedOrg(adminToken, 'Retro Gamers');
    b = await seedOrg(adminToken, 'Esports League');
  });

  afterAll(async () => {
    for (const s of [a, b].filter(Boolean)) {
      await prisma.ticket.deleteMany({ where: { orderId: s.order.id } });
      await prisma.order.deleteMany({ where: { id: s.order.id } });
      await prisma.priceTier.deleteMany({ where: { eventId: s.event.id } });
      await prisma.event.deleteMany({ where: { id: s.event.id } });
      await prisma.venue.deleteMany({ where: { id: s.venue.id } });
      await prisma.contact.deleteMany({ where: { organizationId: s.org.id } });
      await prisma.organization.deleteMany({ where: { id: s.org.id } });
    }
    await cleanupStaff([SYS_EMAIL, ADMIN_EMAIL]);
  });

  const sys = (path) => request(app).get(path).set('Authorization', `Bearer ${sysToken}`);

  it('lists orders, tickets and events for the switcher org only', async () => {
    const orders = await sys('/admin/orders').set('X-Jump-Org', a.org.id);
    expect(orders.status).toBe(200);
    const orderIds = orders.body.data.map((o) => o.id);
    expect(orderIds).toContain(a.order.id);
    expect(orderIds).not.toContain(b.order.id);

    const tickets = await sys('/admin/tickets').set('X-Jump-Org', b.org.id);
    expect(tickets.status).toBe(200);
    const ticketIds = tickets.body.data.map((t) => t.id);
    expect(ticketIds).toContain(b.ticket.id);
    expect(ticketIds).not.toContain(a.ticket.id);

    const events = await sys('/admin/events').set('X-Jump-Org', a.org.id);
    expect(events.status).toBe(200);
    const eventIds = events.body.events.map((e) => e.id);
    expect(eventIds).toContain(a.event.id);
    expect(eventIds).not.toContain(b.event.id);
  });

  it('hides another org’s order detail behind the switcher', async () => {
    expect((await sys(`/admin/orders/${a.order.id}`).set('X-Jump-Org', a.org.id)).status).toBe(200);
    expect((await sys(`/admin/orders/${a.order.id}`).set('X-Jump-Org', b.org.id)).status).toBe(404);
  });

  it('stays unscoped without the header', async () => {
    const orders = await sys('/admin/orders?limit=100');
    expect(orders.status).toBe(200);
    const orderIds = orders.body.data.map((o) => o.id);
    expect(orderIds).toEqual(expect.arrayContaining([a.order.id, b.order.id]));
  });

  it('scans only the switcher org’s tickets', async () => {
    const payload = `jump://ticket?id=${a.ticket.id}&b=${a.ticket.barcode}&e=${a.event.id}`;
    const scan = (orgId) => {
      const req = request(app).post('/tickets/scan').set('Authorization', `Bearer ${sysToken}`);
      return (orgId ? req.set('X-Jump-Org', orgId) : req).send({ payload });
    };
    expect((await scan(a.org.id)).status).toBe(200);
    expect((await scan(b.org.id)).status).toBe(400);
    expect((await scan(null)).status).toBe(200);
  });
});
