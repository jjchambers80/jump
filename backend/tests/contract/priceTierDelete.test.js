// Contract tests for DELETE …/price-tiers/:id (spec 050-J review): the delete
// locks the tier row and recounts every reference inside one transaction, so a
// tier never disappears under an order line (OrderItem's FK is ON DELETE SET
// NULL) and a checkout racing the delete ends one way or the other, never both.

import { jest } from '@jest/globals';
import request from 'supertest';
import { staffToken, joinOrgByToken } from '../helpers/staff.js';

jest.unstable_mockModule('../../src/config/stripe.js', () => {
  let n = 0;
  return {
    default: {
      checkout: {
        sessions: {
          create: jest.fn().mockImplementation((params) => {
            n++;
            return Promise.resolve({ id: `cs_tierdel_${n}`, url: `https://checkout.stripe.com/pay/cs_tierdel_${n}`, payment_intent: `pi_tierdel_${n}`, metadata: params.metadata });
          }),
          retrieve: jest.fn(),
          expire: jest.fn().mockResolvedValue({}),
        },
      },
      webhooks: { constructEvent: jest.fn() },
    },
  };
});

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');

describe('DELETE /organizations/:orgId/events/:eventId/price-tiers/:id (spec 050-J)', () => {
  let token;
  let orgId;
  let eventId;
  const TAG = `tierdel-${Date.now()}`;
  const tiersUrl = () => `/organizations/${orgId}/events/${eventId}/price-tiers`;
  const addTier = (name = 'Doomed') =>
    request(app).post(tiersUrl()).set('Authorization', `Bearer ${token}`).send({ name, price: 5, quantityTotal: 5 });
  const del = (id) => request(app).delete(`${tiersUrl()}/${id}`).set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    token = await staffToken({ role: 'ADMIN', email: `admin@${TAG}.test` });
    const org = await request(app).post('/organizations').set('Authorization', `Bearer ${token}`).send({ name: `Tier Delete ${TAG}` });
    orgId = org.body.id;
    await joinOrgByToken(token, orgId, 'ADMIN');
    const venue = await request(app).post(`/organizations/${orgId}/venues`).set('Authorization', `Bearer ${token}`).send({ name: 'Hall', address: '1 Main St' });
    const event = await request(app)
      .post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${token}`)
      .send({ venueId: venue.body.id, name: 'Delete Race', date: '2027-08-15T19:00:00.000Z', capacity: 1000, priceTiers: [{ name: 'Keep', price: 10, quantityTotal: 10 }] });
    eventId = event.body.id;
    const pub = await request(app).post(`/organizations/${orgId}/events/${eventId}/publish`).set('Authorization', `Bearer ${token}`);
    expect(pub.status).toBe(200);
  });

  afterAll(async () => {
    await prisma.paymentTransaction.deleteMany({ where: { order: { eventId } } });
    await prisma.orderItem.deleteMany({ where: { order: { eventId } } });
    await prisma.order.deleteMany({ where: { eventId } });
    await prisma.contact.deleteMany({ where: { organizationId: orgId } });
    await prisma.priceTier.deleteMany({ where: { eventId } });
    await prisma.event.deleteMany({ where: { id: eventId } });
    await prisma.venue.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
  });

  it('refuses a tier whose only reference is a FAILED order line (409 TIER_IN_USE)', async () => {
    const { body: tier } = await addTier();
    const contact = await prisma.contact.create({ data: { organizationId: orgId, email: `failed@${TAG}.test`, firstName: 'F', lastName: 'F' } });
    await prisma.order.create({
      data: {
        eventId, organizationId: orgId, contactId: contact.id, orderRef: `${TAG}-F1`, totalAmount: 5, subtotalAmount: 5, quantity: 1, status: 'FAILED',
        items: { create: [{ priceTierId: tier.id, quantity: 1, unitPrice: 5 }] },
      },
    });
    const res = await del(tier.id);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('TIER_IN_USE');
    expect(await prisma.priceTier.findUnique({ where: { id: tier.id } })).not.toBeNull();
  });

  it('a checkout racing the delete ends consistently: tier kept with the order, or deleted with no order', async () => {
    for (let round = 0; round < 6; round++) {
      const { body: tier } = await addTier(`Race ${round}`);
      const [order, removed] = await Promise.all([
        request(app).post('/orders').send({
          eventId, priceTierId: tier.id, quantity: 1, contact: { email: `race${round}@${TAG}.test`, firstName: 'R', lastName: 'R' },
        }),
        del(tier.id),
      ]);
      const row = await prisma.priceTier.findUnique({ where: { id: tier.id } });
      if (removed.status === 204) {
        expect(row).toBeNull();
        expect(order.status).not.toBe(201);
      } else {
        expect(removed.status).toBe(409);
        expect(order.status).toBe(201);
        expect(row.quantityReserved).toBe(1);
        expect(await prisma.orderItem.count({ where: { orderId: order.body.orderId, priceTierId: tier.id } })).toBe(1);
      }
      // Never an order line that lost its tier.
      expect(await prisma.orderItem.count({ where: { order: { eventId }, priceTierId: null, kind: 'TICKET_TIER' } })).toBe(0);
    }
  });
});
