// Contract tests for Transactions phase 2 (spec 018): application money in
// the customers list and detail, event analytics revenue breakdown, dashboard
// gross revenue and the collected-tax report. Fixtures are written straight
// to Postgres; the money paths are covered by their own suites.

import { jest } from '@jest/globals';
import request from 'supertest';
import { createHash } from 'node:crypto';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';

jest.unstable_mockModule('../../src/config/stripe.js', () => ({
  default: {
    refunds: { create: jest.fn() },
    charges: { retrieve: jest.fn() },
    checkout: { sessions: { create: jest.fn(), retrieve: jest.fn(), expire: jest.fn() } },
    customers: { create: jest.fn() },
    paymentIntents: { create: jest.fn(), retrieve: jest.fn() },
    setupIntents: { retrieve: jest.fn() },
    webhooks: { constructEvent: jest.fn() },
  },
}));
jest.unstable_mockModule('../../src/config/resend.js', () => ({
  default: { emails: { send: jest.fn(async () => ({ id: 'mock' })) } },
}));

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');

const TAG = 'txnrep';
const auth = (token) => ['Authorization', `Bearer ${token}`];
const sha = (s) => createHash('sha256').update(s).digest('hex');
const T = (day, hour = 12) => new Date(Date.UTC(2026, 8, day, hour));

describe('Transactions reporting contract (spec 018 phase 2)', () => {
  let adminToken;
  let org;
  let event;
  let tier;
  let contacts = {};
  let taxableForm;
  let untaxedForm;
  const emails = [`admin@${TAG}.test`];

  let seq = 0;
  async function order({ contact, status, total, tax = 0, subtotal = null, createdAt = T(1), tickets = 1 }) {
    seq += 1;
    const row = await prisma.order.create({
      data: {
        eventId: event.id,
        contactId: contact.id,
        orderRef: `${TAG.toUpperCase()}-${seq}`,
        totalAmount: total,
        subtotalAmount: subtotal ?? total,
        taxAmount: tax,
        quantity: tickets,
        status,
        createdAt,
        items: { create: { priceTierId: tier.id, quantity: tickets, unitPrice: total / tickets } },
        payment: { create: { stripePaymentIntentId: `pi_${TAG}_${seq}`, amount: total, status: 'SUCCEEDED' } },
      },
    });
    for (let i = 0; i < tickets; i += 1) {
      seq += 1;
      await prisma.ticket.create({ data: { orderId: row.id, eventId: event.id, priceTierId: tier.id, contactId: contact.id, ticketNumber: 7000 + seq, pricePaid: total / tickets, barcode: `${TAG}-${seq}` } });
    }
    return row;
  }

  async function application({ form, contact, profile, paymentStatus, subtotal, tax = 0, paidAt = T(2), refund = 0 }) {
    seq += 1;
    const applicantPays = Math.round((subtotal + tax + 1) * 100) / 100; // +1 processing fee
    const row = await prisma.application.create({
      data: {
        formId: form.id,
        eventId: event.id,
        organizationId: org.id,
        contactId: contact.id,
        profileId: profile.id,
        tierId: form.tiers[0].id,
        status: 'APPROVED',
        paymentStatus,
        capacitySlot: 'APPROVED',
        subtotal,
        platformFee: 0,
        processingFee: 1,
        tax,
        applicantPays,
        orgReceives: subtotal,
        feeMode: 'PASS',
        stripePaymentIntentId: `pi_${TAG}_app_${seq}`,
        paidAt,
        submittedAt: new Date(paidAt.getTime() - 3_600_000),
        statusTokenHash: sha(`${TAG}-${seq}`),
        ...(refund > 0 && { refunds: { create: { amount: refund, status: 'SUCCEEDED', stripeRefundId: `re_${TAG}_${seq}` } } }),
      },
    });
    return row;
  }

  beforeAll(async () => {
    await prisma.organization.deleteMany({ where: { name: { startsWith: `${TAG} ` } } }).catch(() => {});
    adminToken = await staffToken({ email: emails[0], role: 'ADMIN' });
    org = await prisma.organization.create({ data: { name: `${TAG} Expo Co`, email: `owner@${TAG}.test` } });
    await joinOrgByToken(adminToken, org.id, 'ADMIN');
    const venue = await prisma.venue.create({ data: { organizationId: org.id, name: `${TAG} Hall`, address: '1 Main', city: 'Raleigh', state: 'NC' } });
    event = await prisma.event.create({ data: { venueId: venue.id, name: `${TAG} Expo`, date: T(30), status: 'PUBLISHED', capacity: 500, taxRate: 0.0725 } });
    tier = await prisma.priceTier.create({ data: { eventId: event.id, name: 'GA', price: 20, quantityTotal: 100, quantitySold: 3 } });

    const mk = (email, firstName, lastName) => prisma.contact.create({ data: { organizationId: org.id, email, firstName, lastName } });
    contacts = {
      buyer: await mk(`buyer@${TAG}.test`, 'Bea', 'Buyer'), // orders only
      vendor: await mk(`vendor@${TAG}.test`, 'Vic', 'Vendor'), // applications only
      both: await mk(`both@${TAG}.test`, 'Bo', 'Both'), // one of each
      pending: await mk(`pending@${TAG}.test`, 'Pat', 'Pending'), // PAYMENT_DUE only: not a customer
    };

    taxableForm = await prisma.applicationForm.create({ data: { eventId: event.id, kind: 'PAID', name: 'Vendors', slug: 'vendors', status: 'OPEN', taxable: true, tiers: { create: { name: '10x10', price: 200, quantityTotal: 10 } } }, include: { tiers: true } });
    untaxedForm = await prisma.applicationForm.create({ data: { eventId: event.id, kind: 'PAID', name: 'Sponsors', slug: 'sponsors', status: 'OPEN', taxable: false, tiers: { create: { name: 'Gold', price: 500, quantityTotal: 5 } } }, include: { tiers: true } });
    const profiles = {};
    for (const [key, c] of Object.entries(contacts)) {
      profiles[key] = await prisma.applicantProfile.create({ data: { organizationId: org.id, contactId: c.id, businessName: `${c.firstName} Co` } });
    }

    // Orders: 2 tickets at 20 + tax 2.90 → 42.90 for buyer; 1 ticket 21.45 for both
    await order({ contact: contacts.buyer, status: 'COMPLETED', total: 42.9, subtotal: 40, tax: 2.9, tickets: 2, createdAt: T(1) });
    await order({ contact: contacts.both, status: 'COMPLETED', total: 21.45, subtotal: 20, tax: 1.45, createdAt: T(3) });
    // Applications: vendor taxable 200 + 14.50 tax (+1 fee) paid; vendor untaxed sponsor 500 partially refunded 100;
    // both: taxable 200 + 14.50; pending: PAYMENT_DUE (no money)
    await application({ form: taxableForm, contact: contacts.vendor, profile: profiles.vendor, paymentStatus: 'PAID', subtotal: 200, tax: 14.5, paidAt: T(2) });
    await application({ form: untaxedForm, contact: contacts.vendor, profile: profiles.vendor, paymentStatus: 'PARTIALLY_REFUNDED', subtotal: 500, paidAt: T(4), refund: 100 });
    await application({ form: taxableForm, contact: contacts.both, profile: profiles.both, paymentStatus: 'PAID', subtotal: 200, tax: 14.5, paidAt: T(5) });
    seq += 1;
    await prisma.application.create({
      data: {
        formId: taxableForm.id, eventId: event.id, organizationId: org.id, contactId: contacts.pending.id, profileId: profiles.pending.id, tierId: taxableForm.tiers[0].id,
        status: 'APPROVED', paymentStatus: 'PAYMENT_DUE', capacitySlot: 'RESERVED', subtotal: 200, tax: 14.5, applicantPays: 215.5, orgReceives: 200,
        submittedAt: T(6), paymentDueAt: T(12), statusTokenHash: sha(`${TAG}-${seq}`),
      },
    });
  });

  afterAll(async () => {
    await prisma.applicationRefund.deleteMany({ where: { application: { organizationId: org.id } } }).catch(() => {});
    await prisma.application.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.applicantProfile.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.applicationForm.deleteMany({ where: { eventId: event.id } }).catch(() => {});
    await prisma.ticket.deleteMany({ where: { eventId: event.id } }).catch(() => {});
    await prisma.paymentTransaction.deleteMany({ where: { order: { eventId: event.id } } }).catch(() => {});
    await prisma.orderItem.deleteMany({ where: { order: { eventId: event.id } } }).catch(() => {});
    await prisma.order.deleteMany({ where: { eventId: event.id } }).catch(() => {});
    await prisma.priceTier.deleteMany({ where: { eventId: event.id } }).catch(() => {});
    await prisma.event.deleteMany({ where: { id: event.id } }).catch(() => {});
    await prisma.contact.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.venue.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.organization.deleteMany({ where: { id: org.id } }).catch(() => {});
    await cleanupStaff(emails);
  });

  // ─── Customers ───────────────────────────────────────────────────────────

  it('customers include contacts with paid applications; totals cover both; pending money does not make a customer', async () => {
    const res = await request(app).get(`/admin/customers?search=${encodeURIComponent(`@${TAG}.test`)}`).set(...auth(adminToken));
    expect(res.status).toBe(200);
    const byEmail = Object.fromEntries(res.body.data.map((c) => [c.email, c]));
    expect(Object.keys(byEmail).sort()).toEqual([`both@${TAG}.test`, `buyer@${TAG}.test`, `vendor@${TAG}.test`]);

    // Vendor: 215.50 + 501.00 gross, 100 refunded, two transactions, last activity = T(4)
    expect(byEmail[`vendor@${TAG}.test`]).toMatchObject({ transactionCount: 2, orderCount: 2, ticketOrderCount: 0, applicationCount: 2, totalSpent: 716.5, totalRefunded: 100 });
    expect(byEmail[`vendor@${TAG}.test`].lastActivityAt).toBe(T(4).toISOString());
    expect(byEmail[`vendor@${TAG}.test`].lastOrderDate).toBe(T(4).toISOString());
    // Both: 21.45 order + 215.50 application
    expect(byEmail[`both@${TAG}.test`]).toMatchObject({ transactionCount: 2, ticketOrderCount: 1, applicationCount: 1, totalSpent: 236.95, totalRefunded: 0 });
    expect(byEmail[`both@${TAG}.test`].lastActivityAt).toBe(T(5).toISOString());
    // Buyer unchanged from the pre-018 shape
    expect(byEmail[`buyer@${TAG}.test`]).toMatchObject({ transactionCount: 1, orderCount: 1, applicationCount: 0, totalSpent: 42.9 });

    // Business name is searchable
    const byBusiness = await request(app).get('/admin/customers?search=Vic%20Co').set(...auth(adminToken));
    expect(byBusiness.body.data.map((c) => c.email)).toEqual([`vendor@${TAG}.test`]);
  });

  it('customer detail lists applications beside orders; an application-only contact resolves', async () => {
    const both = await request(app).get(`/admin/customers/${contacts.both.id}`).set(...auth(adminToken));
    expect(both.status).toBe(200);
    expect(both.body.orders).toHaveLength(1);
    expect(both.body.applications).toHaveLength(1);
    expect(both.body.applications[0]).toMatchObject({
      form: { name: 'Vendors', kind: 'PAID' },
      tier: { name: '10x10' },
      businessName: 'Bo Co',
      paymentStatus: 'PAID',
      paymentSource: 'stripe',
      applicantPays: 215.5,
      refunded: 0,
      event: { id: event.id, name: `${TAG} Expo` },
      detailUrl: `/admin/events/${event.id}/applications/${both.body.applications[0].id}`,
    });
    expect(both.body).toMatchObject({ transactionCount: 2, totalSpent: 236.95 });

    const vendor = await request(app).get(`/admin/customers/${contacts.vendor.id}`).set(...auth(adminToken));
    expect(vendor.status).toBe(200);
    expect(vendor.body.orders).toEqual([]);
    expect(vendor.body.applications).toHaveLength(2);
    expect(vendor.body.applications[0]).toMatchObject({ paymentStatus: 'PARTIALLY_REFUNDED', refunded: 100 }); // newest first
    expect(vendor.body.totalRefunded).toBe(100);

    const pending = await request(app).get(`/admin/customers/${contacts.pending.id}`).set(...auth(adminToken));
    expect(pending.status).toBe(404);
  });

  // ─── Analytics + dashboard ───────────────────────────────────────────────

  it('event analytics report revenue by source; a refund nets out of applications only', async () => {
    const res = await request(app).get(`/organizations/${org.id}/events/${event.id}/analytics`).set(...auth(adminToken));
    expect(res.status).toBe(200);
    // Tickets: quantitySold 3 × $20 (unchanged semantics); applications gross 215.5 + 501 + 215.5 = 932; refunds 100
    expect(res.body.totals.revenue).toBe(60);
    expect(res.body.revenue).toEqual({ tickets: 60, addOns: 0, applications: 932, applicationCount: 3, applicationRefunds: 100, net: 892 });
  });

  it('dashboard stats carry gross revenue split by source', async () => {
    const res = await request(app).get('/admin/dashboard/stats').set(...auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.revenue).toEqual({ orders: 64.35, applications: 932, gross: 996.35 });
  });

  // ─── Tax report ──────────────────────────────────────────────────────────

  it('tax report includes tax from taxable application forms with a source breakdown; untaxed forms contribute nothing', async () => {
    const res = await request(app).get(`/admin/settings/tax/report?from=${T(1, 0).toISOString()}&to=${T(10).toISOString()}`).set(...auth(adminToken));
    expect(res.status).toBe(200);
    const nc = res.body.rows.find((r) => r.region === 'NC');
    expect(nc).toBeTruthy();
    // Orders: 2 (tax 2.90 + 1.45 = 4.35, taxable 60); applications: 2 taxable (tax 14.50 each, taxable 400). Sponsor form untaxed → excluded.
    expect(nc).toMatchObject({ name: 'North Carolina', count: 4, orders: 4, taxableSales: 460, taxCollected: 33.35, taxRefunded: 0, taxNet: 33.35 });
    expect(nc.sources).toEqual([
      { source: 'order', count: 2, taxableSales: 60, taxCollected: 4.35, taxRefunded: 0, taxNet: 4.35 },
      { source: 'application', count: 2, taxableSales: 400, taxCollected: 29, taxRefunded: 0, taxNet: 29 },
    ]);
    expect(res.body.totals).toMatchObject({ count: 4, taxCollected: 33.35, taxNet: 33.35 });

    // Date basis: applications by paidAt. A window that ends before T(5) drops the second application.
    const early = await request(app).get(`/admin/settings/tax/report?from=${T(1, 0).toISOString()}&to=${T(4, 23).toISOString()}`).set(...auth(adminToken));
    const earlyNc = early.body.rows.find((r) => r.region === 'NC');
    expect(earlyNc.sources.find((s) => s.source === 'application')).toMatchObject({ count: 1, taxCollected: 14.5 });

    const csv = await request(app).get(`/admin/settings/tax/report?format=csv&from=${T(1, 0).toISOString()}&to=${T(10).toISOString()}`).set(...auth(adminToken));
    expect(csv.status).toBe(200);
    const lines = csv.text.trim().split('\n');
    expect(lines[0]).toBe('"Region","State","Source","Count","Taxable sales","Tax collected","Tax refunded (est.)","Tax net"');
    expect(lines).toContain('"North Carolina","NC","Orders","2","60.00","4.35","0.00","4.35"');
    expect(lines).toContain('"North Carolina","NC","Applications","2","400.00","29.00","0.00","29.00"');
    expect(lines.at(-1)).toBe('"Total","","","4","460.00","33.35","0.00","33.35"');
  });
});
