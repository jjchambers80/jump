// Contract tests for Transactions (spec 018 phase 1) — the org-wide union of
// ticket orders and application payments: interleaved pagination, every search
// key, filters, org isolation, refund delegation, refund history, CSV.
// Fixtures are written straight to Postgres (the money paths they represent
// are covered by orders.test.js and applicationPayments.test.js); Stripe is
// mocked so refunds never leave the process.

import { jest } from '@jest/globals';
import request from 'supertest';
import { createHash } from 'node:crypto';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';

const mockRefundsCreate = jest.fn();
const mockChargesRetrieve = jest.fn();
jest.unstable_mockModule('../../src/config/stripe.js', () => ({
  default: {
    refunds: { create: mockRefundsCreate },
    charges: { retrieve: mockChargesRetrieve },
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

const TAG = 'txnct';
const auth = (token) => ['Authorization', `Bearer ${token}`];
const sha = (s) => createHash('sha256').update(s).digest('hex');

// Fixed, interleaved timestamps so the union's ordering is deterministic.
const T = (day, hour = 12) => new Date(Date.UTC(2026, 8, day, hour));

describe('Transactions contract (spec 018 phase 1)', () => {
  let adminToken;
  let organizerToken;
  let sysAdminToken;
  let otherAdminToken;
  let orgA;
  let orgB;
  let eventA;
  let eventA2;
  let tierA;
  let contacts = {};
  const orders = {};
  const apps = {};
  const emails = [`admin@${TAG}.test`, `organizer@${TAG}.test`, `sys@${TAG}.test`, `other@${TAG}.test`];

  let orderSeq = 0;
  let ticketSeq = 0;

  async function makeOrder({ event, contact, status, total, occurredAt, intent, tickets = 1, tierName }) {
    orderSeq += 1;
    const order = await prisma.order.create({
      data: {
        eventId: event.id,
        contactId: contact.id,
        orderRef: `${TAG.toUpperCase()}-${String(orderSeq).padStart(3, '0')}`,
        totalAmount: total,
        subtotalAmount: Math.round(total * 0.9 * 100) / 100,
        platformFeeAmount: Math.round(total * 0.05 * 100) / 100,
        processingFeeAmount: Math.round(total * 0.03 * 100) / 100,
        taxAmount: Math.round(total * 0.02 * 100) / 100,
        quantity: tickets,
        status,
        createdAt: occurredAt,
        items: { create: { priceTierId: tierA.id, quantity: tickets, unitPrice: Math.round((total / tickets) * 100) / 100 } },
        ...(intent && { payment: { create: { stripePaymentIntentId: intent, amount: total, status: status === 'FAILED' ? 'FAILED' : 'SUCCEEDED' } } }),
      },
    });
    if (status === 'COMPLETED' || status === 'PARTIALLY_REFUNDED') {
      for (let i = 0; i < tickets; i += 1) {
        ticketSeq += 1;
        await prisma.ticket.create({
          data: { orderId: order.id, eventId: event.id, priceTierId: tierA.id, contactId: contact.id, ticketNumber: 9000 + ticketSeq, pricePaid: Math.round((total / tickets) * 100) / 100, barcode: `${TAG}-${ticketSeq}` },
        });
      }
    }
    return order;
  }

  async function makeApplication({ form, tier, contact, profile, status, paymentStatus, amount, occurredAt, intent = null, session = null, org = orgA, event = eventA }) {
    const paid = ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(paymentStatus);
    return prisma.application.create({
      data: {
        formId: form.id,
        eventId: event.id,
        organizationId: org.id,
        contactId: contact.id,
        profileId: profile.id,
        tierId: tier.id,
        status,
        paymentStatus,
        capacitySlot: paid ? 'APPROVED' : paymentStatus === 'PAYMENT_DUE' ? 'RESERVED' : 'NONE',
        subtotal: amount,
        platformFee: Math.round(amount * 0.05 * 100) / 100,
        processingFee: 1.0,
        tax: 0,
        applicantPays: Math.round((amount * 1.05 + 1) * 100) / 100,
        orgReceives: amount,
        feeMode: 'PASS',
        stripePaymentIntentId: intent,
        stripeCheckoutSessionId: session,
        paidAt: paid ? occurredAt : null,
        submittedAt: status === 'DRAFT' ? null : new Date(occurredAt.getTime() - 3_600_000),
        paymentDueAt: paymentStatus === 'PAYMENT_DUE' ? new Date(occurredAt.getTime() + 5 * 86_400_000) : null,
        statusTokenHash: sha(`${TAG}-${form.id}-${contact.id}-${paymentStatus}-${occurredAt.toISOString()}`),
        createdAt: new Date(occurredAt.getTime() - 7_200_000),
      },
    });
  }

  beforeAll(async () => {
    await prisma.organization.deleteMany({ where: { name: { startsWith: `${TAG} ` } } }).catch(() => {});
    adminToken = await staffToken({ email: emails[0], role: 'ADMIN' });
    organizerToken = await staffToken({ email: emails[1], role: 'ORGANIZER' });
    sysAdminToken = await staffToken({ email: emails[2], role: 'SYSTEM_ADMIN' });
    otherAdminToken = await staffToken({ email: emails[3], role: 'ADMIN' });

    orgA = await prisma.organization.create({ data: { name: `${TAG} Geek Expo`, email: `a@${TAG}.test` } });
    orgB = await prisma.organization.create({ data: { name: `${TAG} Other Org`, email: `b@${TAG}.test` } });
    await joinOrgByToken(adminToken, orgA.id, 'ADMIN');
    await joinOrgByToken(organizerToken, orgA.id, 'ORGANIZER');
    await joinOrgByToken(otherAdminToken, orgB.id, 'ADMIN');

    const venueA = await prisma.venue.create({ data: { organizationId: orgA.id, name: `${TAG} Hall`, address: '1 Main St', city: 'Raleigh', state: 'NC' } });
    const venueB = await prisma.venue.create({ data: { organizationId: orgB.id, name: `${TAG} Barn`, address: '2 Side St', city: 'Durham', state: 'NC' } });
    eventA = await prisma.event.create({ data: { venueId: venueA.id, name: `${TAG} Expo 2027`, date: T(30), status: 'PUBLISHED', capacity: 500 } });
    eventA2 = await prisma.event.create({ data: { venueId: venueA.id, name: `${TAG} Winter Market`, date: T(28), status: 'PUBLISHED', capacity: 200 } });
    const eventB = await prisma.event.create({ data: { venueId: venueB.id, name: `${TAG} Other Fest`, date: T(29), status: 'PUBLISHED', capacity: 100 } });
    tierA = await prisma.priceTier.create({ data: { eventId: eventA.id, name: 'General Admission', price: 25, quantityTotal: 100, quantitySold: 10 } });
    const tierB = await prisma.priceTier.create({ data: { eventId: eventB.id, name: 'GA', price: 10, quantityTotal: 100 } });

    const mk = (org, email, firstName, lastName) => prisma.contact.create({ data: { organizationId: org.id, email, firstName, lastName } });
    contacts = {
      alice: await mk(orgA, `alice@${TAG}.test`, 'Alice', 'Anderson'),
      bob: await mk(orgA, `bob@${TAG}.test`, 'Bob', 'Baker'),
      vee: await mk(orgA, `vee@${TAG}.test`, 'Vee', 'Vendor'),
      wren: await mk(orgA, `wren@${TAG}.test`, 'Wren', 'Wholesale'),
      zed: await mk(orgB, `zed@${TAG}.test`, 'Zed', 'Zulu'),
    };

    // Application forms + tiers + profiles (orgA and orgB)
    const formA = await prisma.applicationForm.create({ data: { eventId: eventA.id, kind: 'PAID', name: 'Vendor Space', slug: 'vendor-space', status: 'OPEN', tiers: { create: { name: '10x10', price: 275, quantityTotal: 20 } } }, include: { tiers: true } });
    const formB = await prisma.applicationForm.create({ data: { eventId: eventB.id, kind: 'PAID', name: 'Other Vendors', slug: 'other-vendors', status: 'OPEN', tiers: { create: { name: 'Table', price: 50, quantityTotal: 5 } } }, include: { tiers: true } });
    const profileVee = await prisma.applicantProfile.create({ data: { organizationId: orgA.id, contactId: contacts.vee.id, businessName: 'Pixel Pins' } });
    const profileAlice = await prisma.applicantProfile.create({ data: { organizationId: orgA.id, contactId: contacts.alice.id, businessName: 'Alice Crafts' } });
    const profileWren = await prisma.applicantProfile.create({ data: { organizationId: orgA.id, contactId: contacts.wren.id, businessName: 'Wren Wholesale' } });
    const profileZed = await prisma.applicantProfile.create({ data: { organizationId: orgB.id, contactId: contacts.zed.id, businessName: 'Zed Zines' } });

    // Orders (orgA): completed, completed for alice (mixed contact), pending (hidden), failed (hidden)
    orders.bob = await makeOrder({ event: eventA, contact: contacts.bob, status: 'COMPLETED', total: 54.5, occurredAt: T(1), intent: `pi_${TAG}_bob`, tickets: 2 });
    orders.alice = await makeOrder({ event: eventA2, contact: contacts.alice, status: 'COMPLETED', total: 27.25, occurredAt: T(3), intent: `pi_${TAG}_alice` });
    orders.pending = await makeOrder({ event: eventA, contact: contacts.bob, status: 'PENDING', total: 27.25, occurredAt: T(5), intent: null });
    orders.failed = await makeOrder({ event: eventA, contact: contacts.bob, status: 'FAILED', total: 27.25, occurredAt: T(6), intent: `pi_${TAG}_failed` });
    orders.refunded = await makeOrder({ event: eventA, contact: contacts.bob, status: 'PARTIALLY_REFUNDED', total: 81.75, occurredAt: T(7), intent: `pi_${TAG}_prefund`, tickets: 3 });
    await prisma.refund.create({ data: { orderId: orders.refunded.id, amount: 27.25, status: 'SUCCEEDED', stripeRefundId: `re_${TAG}_order1`, reason: 'one ticket', initiatedBy: 'someone' } });
    // orgB order
    const zedOrder = await prisma.order.create({
      data: { eventId: eventB.id, contactId: contacts.zed.id, orderRef: `${TAG.toUpperCase()}-B01`, totalAmount: 10, quantity: 1, status: 'COMPLETED', createdAt: T(2), items: { create: { priceTierId: tierB.id, quantity: 1, unitPrice: 10 } }, payment: { create: { stripePaymentIntentId: `pi_${TAG}_zed`, amount: 10, status: 'SUCCEEDED' } } },
    });
    orders.zed = zedOrder;

    // Applications (orgA): paid vee, paid alice (mixed), payment due wren, card on file wren, draft (hidden), orgB paid
    apps.vee = await makeApplication({ form: formA, tier: formA.tiers[0], contact: contacts.vee, profile: profileVee, status: 'APPROVED', paymentStatus: 'PAID', amount: 275, occurredAt: T(2), intent: `pi_${TAG}_vee`, session: `cs_${TAG}_vee` });
    apps.alice = await makeApplication({ form: formA, tier: formA.tiers[0], contact: contacts.alice, profile: profileAlice, status: 'APPROVED', paymentStatus: 'PAID', amount: 275, occurredAt: T(4), intent: `pi_${TAG}_aliceapp` });
    apps.due = await makeApplication({ form: formA, tier: formA.tiers[0], contact: contacts.wren, profile: profileWren, status: 'APPROVED', paymentStatus: 'PAYMENT_DUE', amount: 275, occurredAt: T(8) });
    apps.card = await makeApplication({ form: formA, tier: formA.tiers[0], contact: contacts.wren, profile: profileWren, status: 'SUBMITTED', paymentStatus: 'CARD_ON_FILE', amount: 275, occurredAt: T(9) });
    apps.draft = await makeApplication({ form: formA, tier: formA.tiers[0], contact: contacts.wren, profile: profileWren, status: 'DRAFT', paymentStatus: 'AWAITING_CARD', amount: 275, occurredAt: T(10) });
    apps.zed = await makeApplication({ form: formB, tier: formB.tiers[0], contact: contacts.zed, profile: profileZed, status: 'APPROVED', paymentStatus: 'PAID', amount: 50, occurredAt: T(11), intent: `pi_${TAG}_zedapp`, org: orgB, event: eventB });
  });

  afterAll(async () => {
    for (const org of [orgA, orgB]) {
      if (!org) continue;
      await prisma.applicationRefund.deleteMany({ where: { application: { organizationId: org.id } } }).catch(() => {});
      await prisma.application.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
      await prisma.applicantProfile.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
      await prisma.applicationForm.deleteMany({ where: { event: { venue: { organizationId: org.id } } } }).catch(() => {});
      await prisma.refund.deleteMany({ where: { order: { event: { venue: { organizationId: org.id } } } } }).catch(() => {});
      await prisma.ticket.deleteMany({ where: { event: { venue: { organizationId: org.id } } } }).catch(() => {});
      await prisma.paymentTransaction.deleteMany({ where: { order: { event: { venue: { organizationId: org.id } } } } }).catch(() => {});
      await prisma.orderItem.deleteMany({ where: { order: { event: { venue: { organizationId: org.id } } } } }).catch(() => {});
      await prisma.order.deleteMany({ where: { event: { venue: { organizationId: org.id } } } }).catch(() => {});
      await prisma.priceTier.deleteMany({ where: { event: { venue: { organizationId: org.id } } } }).catch(() => {});
      await prisma.event.deleteMany({ where: { venue: { organizationId: org.id } } }).catch(() => {});
      await prisma.contact.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
      await prisma.venue.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
      await prisma.organization.deleteMany({ where: { id: org.id } }).catch(() => {});
    }
    await cleanupStaff(emails);
  });

  beforeEach(() => {
    let n = 0;
    mockRefundsCreate.mockReset().mockImplementation(async (params) => ({ id: `re_${TAG}_${++n}`, amount: params.amount, status: 'succeeded' }));
    mockChargesRetrieve.mockReset();
  });

  const list = (token, qs = '') => request(app).get(`/admin/transactions${qs}`).set(...auth(token));
  const keys = (res) => res.body.data.map((t) => `${t.type}:${t.id}`);

  // ─── Listing ─────────────────────────────────────────────────────────────

  it('lists both types newest first, hides PENDING / FAILED orders and DRAFT applications, scoped to the org', async () => {
    const res = await list(adminToken);
    expect(res.status).toBe(200);
    expect(keys(res)).toEqual([
      `APPLICATION:${apps.card.id}`, // T(9) submitted
      `APPLICATION:${apps.due.id}`, // T(8)
      `ORDER:${orders.refunded.id}`, // T(7)
      `APPLICATION:${apps.alice.id}`, // T(4)
      `ORDER:${orders.alice.id}`, // T(3)
      `APPLICATION:${apps.vee.id}`, // T(2)
      `ORDER:${orders.bob.id}`, // T(1)
    ]);
    expect(res.body.pagination).toEqual({ page: 1, pageSize: 50, total: 7, totalPages: 1 });
    const ids = res.body.data.map((t) => t.id);
    expect(ids).not.toContain(orders.pending.id);
    expect(ids).not.toContain(orders.failed.id);
    expect(ids).not.toContain(apps.draft.id);
    expect(ids).not.toContain(orders.zed.id);
    expect(ids).not.toContain(apps.zed.id);
    // No organization column for a scoped member.
    expect(res.body.data[0].organization).toBeUndefined();
  });

  it('projects the row shape for each type', async () => {
    const res = await list(adminToken, `?search=${encodeURIComponent(`vee@${TAG}.test`)}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    const row = res.body.data[0];
    expect(row).toMatchObject({
      type: 'APPLICATION',
      id: apps.vee.id,
      reference: apps.vee.id,
      status: 'PAID',
      sourceStatus: 'PAID',
      paymentSource: 'stripe',
      businessName: 'Pixel Pins',
      contact: { id: contacts.vee.id, name: 'Vee Vendor', email: `vee@${TAG}.test` },
      event: { id: eventA.id, name: `${TAG} Expo 2027` },
      description: 'Vendor Space — 10x10',
      gross: 289.75,
      refunded: 0,
      net: 289.75,
      amountDue: null,
      stripePaymentIntentId: `pi_${TAG}_vee`,
      stripeCheckoutSessionId: `cs_${TAG}_vee`,
      detailUrl: `/admin/events/${eventA.id}/applications/${apps.vee.id}`,
    });
    expect(row.occurredAt).toBe(T(2).toISOString());

    const order = await list(adminToken, `?search=${encodeURIComponent(orders.bob.orderRef)}`);
    expect(order.body.data).toHaveLength(1);
    expect(order.body.data[0]).toMatchObject({
      type: 'ORDER',
      id: orders.bob.id,
      reference: orders.bob.orderRef,
      status: 'PAID',
      sourceStatus: 'COMPLETED',
      businessName: null,
      contact: { name: 'Bob Baker' },
      description: '2 × General Admission',
      gross: 54.5,
      net: 54.5,
      stripePaymentIntentId: `pi_${TAG}_bob`,
      detailUrl: `/admin/orders/${orders.bob.id}`,
    });
  });

  it('paginates the union in the database with a stable order across pages', async () => {
    const p1 = await list(adminToken, '?pageSize=3&page=1');
    const p2 = await list(adminToken, '?pageSize=3&page=2');
    const p3 = await list(adminToken, '?pageSize=3&page=3');
    expect(p1.body.pagination).toMatchObject({ page: 1, pageSize: 3, total: 7, totalPages: 3 });
    const all = [...keys(p1), ...keys(p2), ...keys(p3)];
    expect(all).toHaveLength(7);
    expect(new Set(all).size).toBe(7);
    expect(all).toEqual(keys(await list(adminToken)));
    // `limit` is accepted as an alias.
    expect((await list(adminToken, '?limit=2')).body.data).toHaveLength(2);
    // Ascending date flips the order.
    expect(keys(await list(adminToken, '?sort=date'))).toEqual(keys(await list(adminToken)).reverse());
  });

  it('pending money: PAYMENT_DUE shows the amount due with gross 0; card on file shows as PENDING', async () => {
    const due = await list(adminToken, '?status=PAYMENT_DUE');
    expect(due.body.data).toHaveLength(1);
    expect(due.body.data[0]).toMatchObject({ id: apps.due.id, status: 'PAYMENT_DUE', gross: 0, net: 0, amountDue: 289.75 });
    expect(due.body.data[0].dueAt).toBeTruthy();

    const pending = await list(adminToken, '?status=PENDING');
    expect(pending.body.data.map((t) => t.id).sort()).toEqual([apps.card.id, orders.pending.id].sort());
    const card = pending.body.data.find((t) => t.id === apps.card.id);
    expect(card).toMatchObject({ status: 'PENDING', sourceStatus: 'CARD_ON_FILE', gross: 0 });
  });

  // ─── Filters ─────────────────────────────────────────────────────────────

  it('filters by type, status, event, date range and hasRefunds', async () => {
    expect(keys(await list(adminToken, '?type=ORDER'))).toEqual([`ORDER:${orders.refunded.id}`, `ORDER:${orders.alice.id}`, `ORDER:${orders.bob.id}`]);
    expect(keys(await list(adminToken, '?type=APPLICATION&status=PAID'))).toEqual([`APPLICATION:${apps.alice.id}`, `APPLICATION:${apps.vee.id}`]);
    expect(keys(await list(adminToken, '?status=FAILED'))).toEqual([`ORDER:${orders.failed.id}`]);
    expect(keys(await list(adminToken, `?eventId=${eventA2.id}`))).toEqual([`ORDER:${orders.alice.id}`]);
    expect(keys(await list(adminToken, `?from=${T(3).toISOString()}&to=${T(4, 13).toISOString()}`))).toEqual([`APPLICATION:${apps.alice.id}`, `ORDER:${orders.alice.id}`]);
    expect(keys(await list(adminToken, '?hasRefunds=true'))).toEqual([`ORDER:${orders.refunded.id}`]);
    expect(keys(await list(adminToken, '?hasRefunds=false'))).not.toContain(`ORDER:${orders.refunded.id}`);
    // A filter combination that selects nothing is an empty page, not an error.
    const none = await list(adminToken, '?type=ORDER&status=PAYMENT_DUE');
    expect(none.status).toBe(200);
    expect(none.body).toEqual({ data: [], pagination: { page: 1, pageSize: 50, total: 0, totalPages: 0 } });
  });

  it('rejects bad query values with 400', async () => {
    expect((await list(adminToken, '?type=INVOICE')).status).toBe(400);
    expect((await list(adminToken, '?status=OPEN')).status).toBe(400);
    expect((await list(adminToken, '?from=notadate')).status).toBe(400);
    expect((await list(adminToken, '?page=0')).status).toBe(400);
    expect((await list(adminToken, '?pageSize=500')).status).toBe(400);
    expect((await list(adminToken, '?sort=amount')).status).toBe(400);
    expect((await list(adminToken, '?hasRefunds=maybe')).status).toBe(400);
  });

  // ─── Search ──────────────────────────────────────────────────────────────

  it('search matches email, name, business name, orderRef, application id and every Stripe id', async () => {
    const one = async (qs, expected) => {
      const res = await list(adminToken, `?search=${encodeURIComponent(qs)}`);
      expect(res.status).toBe(200);
      expect(keys(res)).toEqual(expected);
    };
    // A contact with both an order and an application: two rows.
    await one(`alice@${TAG}.test`, [`APPLICATION:${apps.alice.id}`, `ORDER:${orders.alice.id}`]);
    await one('Alice Anderson', [`APPLICATION:${apps.alice.id}`, `ORDER:${orders.alice.id}`]);
    await one('pixel pins', [`APPLICATION:${apps.vee.id}`]);
    await one(orders.bob.orderRef.toLowerCase(), [`ORDER:${orders.bob.id}`]);
    await one(apps.vee.id, [`APPLICATION:${apps.vee.id}`]);
    await one(`pi_${TAG}_bob`, [`ORDER:${orders.bob.id}`]);
    await one(`pi_${TAG}_vee`, [`APPLICATION:${apps.vee.id}`]);
    await one(`cs_${TAG}_vee`, [`APPLICATION:${apps.vee.id}`]);
    await one(`re_${TAG}_order1`, [`ORDER:${orders.refunded.id}`]);
    await one(`pi_${TAG}_nope`, []);
  });

  it('a ch_ search resolves the charge to its PaymentIntent through Stripe; an unknown charge yields no rows', async () => {
    mockChargesRetrieve.mockResolvedValueOnce({ id: `ch_${TAG}_1`, payment_intent: `pi_${TAG}_vee` });
    const hit = await list(adminToken, `?search=ch_${TAG}_1`);
    expect(hit.status).toBe(200);
    expect(keys(hit)).toEqual([`APPLICATION:${apps.vee.id}`]);
    expect(mockChargesRetrieve).toHaveBeenCalledWith(`ch_${TAG}_1`);

    mockChargesRetrieve.mockRejectedValueOnce(new Error('No such charge'));
    const miss = await list(adminToken, `?search=ch_${TAG}_missing`);
    expect(miss.status).toBe(200);
    expect(miss.body.data).toEqual([]);
  });

  // ─── Scope ───────────────────────────────────────────────────────────────

  it('org B sees only its rows; SYSTEM_ADMIN sees all with an organization column and may narrow with ?organizationId=', async () => {
    const b = await list(otherAdminToken);
    expect(keys(b)).toEqual([`APPLICATION:${apps.zed.id}`, `ORDER:${orders.zed.id}`]);

    const all = await list(sysAdminToken, `?search=${encodeURIComponent(`@${TAG}.test`)}`);
    expect(all.status).toBe(200);
    const ids = all.body.data.map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining([orders.zed.id, apps.zed.id, orders.bob.id, apps.vee.id]));
    expect(all.body.data.find((t) => t.id === apps.zed.id).organization).toEqual({ id: orgB.id, name: `${TAG} Other Org` });

    const narrowed = await list(sysAdminToken, `?organizationId=${orgB.id}`);
    expect(keys(narrowed)).toEqual([`APPLICATION:${apps.zed.id}`, `ORDER:${orders.zed.id}`]);
    const viaHeader = await request(app).get('/admin/transactions').set(...auth(sysAdminToken)).set('X-Jump-Org', orgB.id);
    expect(keys(viaHeader)).toEqual([`APPLICATION:${apps.zed.id}`, `ORDER:${orders.zed.id}`]);
  });

  it('cross-org ids are 404 for refunds and history; UNASSIGNED is 403', async () => {
    expect((await request(app).get(`/admin/transactions/ORDER/${orders.zed.id}/refunds`).set(...auth(adminToken))).status).toBe(404);
    expect((await request(app).post(`/admin/transactions/APPLICATION/${apps.zed.id}/refund`).set(...auth(adminToken)).send({})).status).toBe(404);
    expect((await request(app).get(`/admin/transactions/ORDER/${orders.bob.id}/refunds`).set(...auth(adminToken))).status).toBe(200);
    const unassigned = await staffToken({ email: `nobody@${TAG}.test`, role: 'UNASSIGNED' });
    expect((await list(unassigned)).status).toBe(403);
    await cleanupStaff([`nobody@${TAG}.test`]);
  });

  it('rejects an unknown :type', async () => {
    expect((await request(app).get(`/admin/transactions/INVOICE/${orders.bob.id}/refunds`).set(...auth(adminToken))).status).toBe(400);
  });

  // ─── Refunds ─────────────────────────────────────────────────────────────

  it('refund history is normalised across both ledgers', async () => {
    const res = await request(app).get(`/admin/transactions/order/${orders.refunded.id}/refunds`).set(...auth(organizerToken));
    expect(res.status).toBe(200);
    expect(res.body.refunds).toHaveLength(1);
    expect(res.body.refunds[0]).toMatchObject({ amount: 27.25, status: 'SUCCEEDED', stripeRefundId: `re_${TAG}_order1`, reason: 'one ticket', initiatedBy: 'someone', manual: false, detail: 'Full order' });

    const none = await request(app).get(`/admin/transactions/APPLICATION/${apps.vee.id}/refunds`).set(...auth(organizerToken));
    expect(none.status).toBe(200);
    expect(none.body.refunds).toEqual([]);
  });

  it('ORGANIZER cannot refund from Transactions (403), nor from the order routes any more', async () => {
    expect((await request(app).post(`/admin/transactions/APPLICATION/${apps.vee.id}/refund`).set(...auth(organizerToken)).send({ amount: 5 })).status).toBe(403);
    expect((await request(app).post(`/admin/orders/${orders.bob.id}/refund`).set(...auth(organizerToken)).send({})).status).toBe(403);
    expect(mockRefundsCreate).not.toHaveBeenCalled();
  });

  it('ADMIN partial refund of an application delegates to ApplicationPaymentService: ledger row, status, updated transaction row', async () => {
    const res = await request(app).post(`/admin/transactions/APPLICATION/${apps.vee.id}/refund`).set(...auth(adminToken)).send({ amount: 5, reason: 'Goodwill' });
    expect(res.status).toBe(200);
    expect(mockRefundsCreate).toHaveBeenCalledTimes(1);
    expect(mockRefundsCreate.mock.calls[0][0]).toMatchObject({ payment_intent: `pi_${TAG}_vee`, amount: 500, metadata: { applicationId: apps.vee.id } });

    expect(res.body.transaction).toMatchObject({ type: 'APPLICATION', id: apps.vee.id, status: 'PARTIALLY_REFUNDED', gross: 289.75, refunded: 5, net: 284.75 });
    expect(res.body.refunds).toHaveLength(1);
    expect(res.body.refunds[0]).toMatchObject({ amount: 5, status: 'SUCCEEDED', reason: 'Goodwill', manual: false });
    expect(res.body.refunds[0].initiatedBy).toBeTruthy();

    const row = await prisma.application.findUnique({ where: { id: apps.vee.id }, include: { refunds: true } });
    expect(row.paymentStatus).toBe('PARTIALLY_REFUNDED');
    expect(row.refunds).toHaveLength(1);
    expect(row.refunds[0].initiatedBy).toBe(row.refunds[0].initiatedBy && res.body.refunds[0].initiatedBy);

    // It now shows up under the refunds filter alongside the pre-refunded order.
    expect(keys(await list(adminToken, '?hasRefunds=true'))).toEqual([`ORDER:${orders.refunded.id}`, `APPLICATION:${apps.vee.id}`]);
  });

  it('ADMIN full refund of an order delegates to RefundService; a partial amount on an order is 400', async () => {
    const partial = await request(app).post(`/admin/transactions/ORDER/${orders.bob.id}/refund`).set(...auth(adminToken)).send({ amount: 10 });
    expect(partial.status).toBe(400);
    expect(mockRefundsCreate).not.toHaveBeenCalled();

    const res = await request(app).post(`/admin/transactions/ORDER/${orders.bob.id}/refund`).set(...auth(adminToken)).send({ reason: 'Event cancelled' });
    expect(res.status).toBe(200);
    expect(mockRefundsCreate).toHaveBeenCalledTimes(1);
    expect(mockRefundsCreate.mock.calls[0][0]).toMatchObject({ payment_intent: `pi_${TAG}_bob`, amount: 5450 });
    expect(res.body.transaction).toMatchObject({ type: 'ORDER', id: orders.bob.id, status: 'REFUNDED', gross: 54.5, refunded: 54.5, net: 0 });
    expect(res.body.refunds[0]).toMatchObject({ amount: 54.5, status: 'SUCCEEDED', detail: 'Full order' });

    const order = await prisma.order.findUnique({ where: { id: orders.bob.id }, include: { tickets: true } });
    expect(order.status).toBe('REFUNDED');
    expect(order.tickets.every((t) => t.status === 'VOIDED')).toBe(true);

    // Refunding a refunded order is a conflict, and an unknown-field body is 400.
    expect((await request(app).post(`/admin/transactions/ORDER/${orders.bob.id}/refund`).set(...auth(adminToken)).send({})).status).toBe(409);
    expect((await request(app).post(`/admin/transactions/ORDER/${orders.alice.id}/refund`).set(...auth(adminToken)).send({ note: 'x' })).status).toBe(400);
  });

  // ─── CSV ─────────────────────────────────────────────────────────────────

  it('CSV export honours the filters and adds one row per refund', async () => {
    const res = await request(app).get('/admin/transactions/export.csv?hasRefunds=true').set(...auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="transactions-\d{4}-\d{2}-\d{2}\.csv"/);
    const lines = res.text.trim().split('\n');
    expect(lines[0]).toBe(
      '"kind","type","reference","occurredAt","status","paymentSource","contactName","contactEmail","businessName","organization","event","description","subtotal","platformFee","processingFee","tax","gross","refunded","net","stripePaymentIntentId","stripeCheckoutSessionId","stripeRefundId","stripeAccountId","detailUrl"'
    );
    // Three refunded transactions (partially refunded order, refunded application, refunded order), each followed by its refund rows.
    const kinds = lines.slice(1).map((l) => l.split(',')[0]);
    expect(kinds).toEqual(['"transaction"', '"refund"', '"transaction"', '"refund"', '"transaction"', '"refund"']);
    const veeLine = lines.find((l) => l.includes(`"${apps.vee.id}"`) && l.startsWith('"transaction"'));
    expect(veeLine).toContain('"Pixel Pins"');
    expect(veeLine).toContain('"289.75","5.00","284.75"');
    const veeRefund = lines.find((l) => l.includes(`"${apps.vee.id}"`) && l.startsWith('"refund"'));
    expect(veeRefund).toContain('"Goodwill"');
    expect(veeRefund).toMatch(/"re_txnct_\d+"/);

    const empty = await request(app).get('/admin/transactions/export.csv?type=ORDER&status=PAYMENT_DUE').set(...auth(adminToken));
    expect(empty.status).toBe(200);
    expect(empty.text.trim().split('\n')).toHaveLength(1);
  });
});
