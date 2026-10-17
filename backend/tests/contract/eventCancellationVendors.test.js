// Spec 054-D: vendor applications when a paid event is cancelled. Live
// applications with nothing to refund are withdrawn at once (slot, held space
// and add-ons released, no "withdrawn" email) and told the event is off; a
// paid vendor is refunded by the sweep and told after the refund; a vendor
// payment still settling is retried until it lands, then refunded; a
// rejected application is left alone.

import { jest } from '@jest/globals';
import request from 'supertest';
import { staffToken, joinOrgByToken, cleanupStaff, reauthHeader } from '../helpers/staff.js';

const sentEmails = [];
const refundCalls = [];
let counter = 0;

jest.unstable_mockModule('../../src/config/resend.js', () => ({
  default: { emails: { send: jest.fn(async (msg) => { sentEmails.push(msg); return { data: { id: 'mock' }, error: null }; }) } },
}));
jest.unstable_mockModule('../../src/config/stripe.js', () => ({
  default: {
    checkout: { sessions: { create: jest.fn(), retrieve: jest.fn(async (id) => ({ id })), expire: jest.fn(async (id) => ({ id, status: 'expired' })) } },
    refunds: {
      create: jest.fn(async (params, options) => {
        refundCalls.push({ params, options });
        return { id: `re_vendor_${++counter}`, amount: params.amount, status: 'succeeded' };
      }),
    },
    webhooks: { constructEvent: jest.fn() },
  },
}));

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');
const { default: eventCancellationService } = await import('../../src/services/EventCancellationService.js');

const TAG = `evt-vendors-${Date.now()}`;
const minutesFromNow = (m) => () => new Date(Date.now() + m * 60 * 1000);

describe('Vendors of a cancelled event (spec 054-D)', () => {
  let adminToken;
  let org;
  let event;
  let tier;
  const apps = {};
  const orders = {};
  const emails = [`admin@${TAG}.test`];
  const vendorEmail = (key) => `${key}@${TAG}.test`;
  const mailTo = (key) => sentEmails.filter((m) => m.to.includes(vendorEmail(key)));

  const application = async (key, form, data, order) => {
    const contact = await prisma.contact.create({ data: { organizationId: org.id, email: vendorEmail(key), firstName: key, lastName: 'Vendor' } });
    apps[key] = await prisma.application.create({
      data: { formId: form.id, eventId: event.id, organizationId: org.id, contactId: contact.id, statusTokenHash: `${TAG}-${key}`, submittedAt: new Date(), ...data },
    });
    if (order) {
      orders[key] = await prisma.order.create({
        data: { kind: 'APPLICATION', applicationId: apps[key].id, eventId: event.id, organizationId: org.id, contactId: contact.id, orderRef: `${TAG}-${key}`, totalAmount: 100, subtotalAmount: 100, quantity: 1, ...order },
      });
      await prisma.paymentTransaction.create({
        data: { orderId: orders[key].id, stripePaymentIntentId: `pi_${TAG}_${key}`, amount: 100, status: order.status === 'COMPLETED' ? 'SUCCEEDED' : 'PENDING' },
      });
    }
  };

  beforeAll(async () => {
    adminToken = await staffToken({ email: emails[0], role: 'ADMIN' });
    org = await prisma.organization.create({ data: { name: `${TAG} Org`, email: `store@${TAG}.test` } });
    await joinOrgByToken(adminToken, org.id, 'ADMIN');
    const venue = await prisma.venue.create({ data: { organizationId: org.id, name: `${TAG} Hall`, address: '1 Main St', city: 'Raleigh', state: 'NC', timezone: 'America/New_York' } });
    event = await prisma.event.create({ data: { venueId: venue.id, name: `${TAG} Market`, date: new Date('2027-09-18T23:00:00Z'), status: 'PUBLISHED', capacity: 100 } });
    const paidForm = await prisma.applicationForm.create({ data: { organizationId: org.id, eventId: event.id, kind: 'PAID', name: 'Vendors', slug: `${TAG}-vendors`, status: 'OPEN' } });
    const freeForm = await prisma.applicationForm.create({ data: { organizationId: org.id, eventId: event.id, kind: 'FREE', name: 'Press', slug: `${TAG}-press`, status: 'OPEN', businessFields: [] } });
    tier = await prisma.applicationTier.create({ data: { formId: paidForm.id, name: 'Booth', price: 100, quantityTotal: 10, quantityApproved: 1, quantityReserved: 1 } });

    await application('paid', paidForm, { tierId: tier.id, status: 'APPROVED', paymentStatus: 'PAID', capacitySlot: 'APPROVED' }, { status: 'COMPLETED', paidAt: new Date() });
    await application('settling', paidForm, { tierId: tier.id, status: 'APPROVED', paymentStatus: 'PROCESSING', capacitySlot: 'NONE' }, { status: 'PENDING' });
    await application('choosing', paidForm, { tierId: tier.id, status: 'APPROVED', paymentStatus: 'AWAITING_SELECTION', capacitySlot: 'RESERVED' });
    await application('press', freeForm, { status: 'SUBMITTED', paymentStatus: 'NOT_REQUIRED' });
    await application('rejected', freeForm, { status: 'REJECTED', paymentStatus: 'NOT_REQUIRED' });
  });

  afterAll(async () => {
    await prisma.eventCancellation.deleteMany({ where: { eventId: event.id } }).catch(() => {});
    await prisma.refund.deleteMany({ where: { order: { eventId: event.id } } }).catch(() => {});
    await prisma.paymentTransaction.deleteMany({ where: { order: { eventId: event.id } } }).catch(() => {});
    await prisma.order.deleteMany({ where: { eventId: event.id } }).catch(() => {});
    await prisma.applicationDecision.deleteMany({ where: { application: { eventId: event.id } } }).catch(() => {});
    await prisma.application.deleteMany({ where: { eventId: event.id } }).catch(() => {});
    await prisma.applicationTier.deleteMany({ where: { form: { eventId: event.id } } }).catch(() => {});
    await prisma.applicationForm.deleteMany({ where: { eventId: event.id } }).catch(() => {});
    await prisma.contact.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.event.deleteMany({ where: { id: event.id } }).catch(() => {});
    await prisma.venue.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.organization.deleteMany({ where: { id: org.id } }).catch(() => {});
    await cleanupStaff(emails);
  });

  it('the dialog counts the live applications and the paid vendors', async () => {
    const res = await request(app).get(`/organizations/${org.id}/events/${event.id}/cancellation-preview`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.body).toMatchObject({ orders: 0, vendorsPaid: 1, applications: 4 });
  });

  it('cancelling withdraws vendors with nothing to refund, releases their slots and tells them once', async () => {
    const res = await request(app)
      .post(`/organizations/${org.id}/events/${event.id}/cancel`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set(...(await reauthHeader(adminToken)))
      .send({ mode: 'REFUND_ALL' });
    expect(res.status).toBe(200);

    const items = await prisma.eventCancellationItem.findMany({ where: { cancellation: { eventId: event.id } } });
    expect(items.map((i) => i.orderId).sort()).toEqual([orders.paid.id, orders.settling.id].sort());

    for (const key of ['choosing', 'press']) {
      expect(await prisma.application.findUnique({ where: { id: apps[key].id } })).toMatchObject({ status: 'WITHDRAWN', withdrawnBy: 'ORGANIZER', withdrawReason: 'Event cancelled' });
      expect(mailTo(key)).toHaveLength(1);
      expect(mailTo(key)[0].subject).toBe(`${event.name} has been cancelled`);
      expect(mailTo(key)[0].text).not.toContain("We've refunded");
      expect(mailTo(key)[0].text).not.toContain('will contact you');
    }
    // The approval slot the choosing vendor held is back.
    expect((await prisma.applicationTier.findUnique({ where: { id: tier.id } })).quantityReserved).toBe(0);
    // Paid and settling vendors wait for the sweep; the rejected one is left alone.
    for (const key of ['paid', 'settling']) expect(mailTo(key)).toHaveLength(0);
    expect((await prisma.application.findUnique({ where: { id: apps.rejected.id } })).status).toBe('REJECTED');
    expect(mailTo('rejected')).toHaveLength(0);
    expect(sentEmails.some((m) => String(m.subject).includes('has been withdrawn'))).toBe(false);
  });

  it('the sweep refunds the paid vendor and then tells them; a payment still settling waits', async () => {
    await eventCancellationService.sweep();
    expect(refundCalls.filter((c) => c.params.payment_intent === `pi_${TAG}_paid`)).toHaveLength(1);
    expect((await prisma.order.findUnique({ where: { id: orders.paid.id } })).status).toBe('REFUNDED');
    expect(mailTo('paid')).toHaveLength(1);
    expect(mailTo('paid')[0].text).toContain("We've refunded $100.00 to the card you paid with");

    const settling = await prisma.eventCancellationItem.findUnique({ where: { orderId: orders.settling.id } });
    expect(settling).toMatchObject({ status: 'PENDING', attempts: 1, error: expect.stringContaining('still being confirmed') });
    expect(mailTo('settling')).toHaveLength(0);
  });

  it('once the settling payment lands, the next try refunds it and tells the vendor', async () => {
    await prisma.$transaction([
      prisma.order.update({ where: { id: orders.settling.id }, data: { status: 'COMPLETED', paidAt: new Date() } }),
      prisma.paymentTransaction.update({ where: { orderId: orders.settling.id }, data: { status: 'SUCCEEDED' } }),
      prisma.application.update({ where: { id: apps.settling.id }, data: { paymentStatus: 'PAID', capacitySlot: 'APPROVED' } }),
    ]);
    await eventCancellationService.sweep({ now: minutesFromNow(2) });
    expect(await prisma.eventCancellationItem.findUnique({ where: { orderId: orders.settling.id } })).toMatchObject({ status: 'REFUNDED' });
    expect(mailTo('settling')).toHaveLength(1);
    expect((await prisma.eventCancellation.findUnique({ where: { eventId: event.id } })).completedAt).not.toBeNull();
  });
});
