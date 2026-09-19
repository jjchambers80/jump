// Contract tests for the org-wide order list (spec 024 phase 2): both kinds
// in one list, every search key (order ref, name, email, business name,
// Stripe payment-intent / refund / session ids), kind / status / event / date
// filters, the default exclusion of FAILED + CANCELLED, org scope and the
// SYSTEM_ADMIN organization column, sorting and paging, the CSV export with
// one refund line per succeeded refund, and the buyer's own order list.
// Fixtures written straight to Postgres; Stripe / Resend never called.

import { jest } from '@jest/globals';
import request from 'supertest';
import { createHash } from 'node:crypto';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';

jest.unstable_mockModule('../../src/config/stripe.js', () => ({
  default: {
    refunds: { create: jest.fn() },
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
const { default: buyerAuthService } = await import('../../src/services/BuyerAuthService.js');

const TAG = 'ordlist';
const auth = (token) => ['Authorization', `Bearer ${token}`];
const sha = (s) => createHash('sha256').update(s).digest('hex');
const T = (day, hour = 12) => new Date(Date.UTC(2026, 8, day, hour));

describe('Org-wide order list contract (spec 024 phase 2)', () => {
  let adminToken;
  let organizerToken;
  let sysToken;
  let org;
  let other;
  let event;
  let otherEvent;
  let tier;
  let form;
  let contacts;
  const emails = [`admin@${TAG}.test`, `organizer@${TAG}.test`, `sys@${TAG}.test`];
  const ids = {};

  let seq = 0;
  async function order({
    contact,
    status,
    total,
    subtotal = null,
    tax = 0,
    createdAt,
    paidAt = null,
    intent = null,
    refunds = [],
    ev = event,
  }) {
    seq += 1;
    const ref = `${TAG.toUpperCase()}-${String(seq).padStart(2, '0')}`;
    return prisma.order.create({
      data: {
        eventId: ev.id,
        contactId: contact.id,
        orderRef: ref,
        totalAmount: total,
        subtotalAmount: subtotal ?? total,
        taxAmount: tax,
        orgReceives: subtotal ?? total,
        quantity: 2,
        status,
        createdAt,
        paidAt,
        ...(intent && { stripeSessionId: `cs_${TAG}_${seq}` }),
        items: {
          create: {
            kind: 'TICKET_TIER',
            priceTierId: tier.id,
            description: 'GA',
            quantity: 2,
            unitPrice: (subtotal ?? total) / 2,
          },
        },
        ...(intent && {
          payment: {
            create: { stripePaymentIntentId: intent, amount: total, status: 'SUCCEEDED' },
          },
        }),
        ...(refunds.length && {
          refunds: {
            create: refunds.map((r, i) => ({
              amount: r.amount,
              status: r.status ?? 'SUCCEEDED',
              stripeRefundId: r.id ?? `re_${TAG}_${seq}_${i}`,
              reason: r.reason ?? null,
              createdAt: r.createdAt ?? createdAt,
            })),
          },
        }),
      },
    });
  }

  async function application({
    contact,
    businessName,
    status = 'APPROVED',
    paymentStatus,
    total,
    createdAt,
    paidAt = null,
    dueAt = null,
    intent = null,
    session = null,
    offline = null,
    refunds = [],
  }) {
    seq += 1;
    const profile = await prisma.applicantProfile.upsert({
      where: { organizationId_contactId: { organizationId: org.id, contactId: contact.id } },
      update: { businessName },
      create: { organizationId: org.id, contactId: contact.id, businessName },
    });
    const app = await prisma.application.create({
      data: {
        formId: form.id,
        eventId: event.id,
        organizationId: org.id,
        contactId: contact.id,
        profileId: profile.id,
        tierId: form.tiers[0].id,
        status,
        paymentStatus,
        capacitySlot: paymentStatus === 'PAID' ? 'APPROVED' : 'NONE',
        submittedAt: createdAt,
        statusTokenHash: sha(`${TAG}-${seq}`),
        ...(session && { stripeCheckoutSessionId: session }),
      },
    });
    const orderStatus =
      {
        PAID: 'COMPLETED',
        PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
        REFUNDED: 'REFUNDED',
        NOT_REQUIRED: 'COMPLETED',
      }[paymentStatus] ?? (['REJECTED', 'WITHDRAWN'].includes(status) ? 'CANCELLED' : 'PENDING');
    const row = await prisma.order.create({
      data: {
        kind: 'APPLICATION',
        eventId: event.id,
        contactId: contact.id,
        applicationId: app.id,
        orderRef: `${TAG.toUpperCase()}-A${String(seq).padStart(2, '0')}`,
        totalAmount: total,
        subtotalAmount: total,
        orgReceives: total,
        quantity: 1,
        status: orderStatus,
        createdAt,
        paidAt,
        dueAt,
        items: {
          create: {
            kind: 'APPLICATION_TIER',
            applicationTierId: form.tiers[0].id,
            description: 'Booth',
            quantity: 1,
            unitPrice: total,
          },
        },
        ...(intent && {
          payment: {
            create: {
              stripePaymentIntentId: intent,
              amount: total,
              status: paidAt ? 'SUCCEEDED' : 'FAILED',
            },
          },
        }),
        ...(offline && {
          payment: {
            create: {
              amount: total,
              status: 'SUCCEEDED',
              source: 'OFFLINE',
              offlineMethod: offline,
              offlineReference: '#9',
            },
          },
        }),
        ...(refunds.length && {
          refunds: {
            create: refunds.map((r, i) => ({
              amount: r.amount,
              status: 'SUCCEEDED',
              stripeRefundId: r.manual ? null : `re_${TAG}_${seq}_${i}`,
              manual: r.manual === true,
              createdAt: r.createdAt ?? createdAt,
            })),
          },
        }),
      },
    });
    return { app, order: row };
  }

  beforeAll(async () => {
    await prisma.organization
      .deleteMany({ where: { name: { startsWith: `${TAG} ` } } })
      .catch(() => {});
    adminToken = await staffToken({ email: emails[0], role: 'ADMIN' });
    organizerToken = await staffToken({ email: emails[1], role: 'ORGANIZER' });
    sysToken = await staffToken({ email: emails[2], role: 'SYSTEM_ADMIN' });
    org = await prisma.organization.create({
      data: { name: `${TAG} Expo Co`, email: `owner@${TAG}.test` },
    });
    other = await prisma.organization.create({
      data: { name: `${TAG} Other Co`, email: `other@${TAG}.test` },
    });
    await joinOrgByToken(adminToken, org.id, 'ADMIN');
    await joinOrgByToken(organizerToken, org.id, 'ORGANIZER');
    const venue = await prisma.venue.create({
      data: {
        organizationId: org.id,
        name: `${TAG} Hall`,
        address: '1 Main',
        city: 'Raleigh',
        state: 'NC',
      },
    });
    const otherVenue = await prisma.venue.create({
      data: { organizationId: other.id, name: `${TAG} Other Hall`, address: '2 Main' },
    });
    event = await prisma.event.create({
      data: {
        venueId: venue.id,
        name: `${TAG} Expo`,
        date: T(30),
        status: 'PUBLISHED',
        capacity: 500,
      },
    });
    otherEvent = await prisma.event.create({
      data: {
        venueId: otherVenue.id,
        name: `${TAG} Other Expo`,
        date: T(30),
        status: 'PUBLISHED',
        capacity: 50,
      },
    });
    tier = await prisma.priceTier.create({
      data: { eventId: event.id, name: 'GA', price: 20, quantityTotal: 100 },
    });
    const otherTier = await prisma.priceTier.create({
      data: { eventId: otherEvent.id, name: 'GA', price: 20, quantityTotal: 100 },
    });
    form = await prisma.applicationForm.create({
      data: {
        eventId: event.id,
        kind: 'PAID',
        name: 'Vendors',
        slug: 'vendors',
        status: 'OPEN',
        tiers: { create: { name: 'Booth', price: 200, quantityTotal: 10 } },
      },
      include: { tiers: true },
    });

    const mk = (email, firstName, lastName, o = org) =>
      prisma.contact.create({ data: { organizationId: o.id, email, firstName, lastName } });
    contacts = {
      buyer: await mk(`bea@${TAG}.test`, 'Bea', 'Buyer'),
      vendor: await mk(`vic@${TAG}.test`, 'Vic', 'Vendor'),
      both: await mk(`bo@${TAG}.test`, 'Bo', 'Both'),
      stranger: await mk(`stranger@${TAG}.test`, 'Sam', 'Stranger', other),
    };

    // Ticket orders: completed (refunded 10), pending (abandoned checkout), failed
    ids.ticketPaid = (
      await order({
        contact: contacts.buyer,
        status: 'PARTIALLY_REFUNDED',
        total: 44.9,
        subtotal: 40,
        tax: 4.9,
        createdAt: T(1),
        paidAt: T(1, 13),
        intent: `pi_${TAG}_ticket`,
        refunds: [{ amount: 10, id: `re_${TAG}_ticket`, reason: 'One ticket' }],
      })
    ).id;
    ids.ticketPending = (
      await order({ contact: contacts.both, status: 'PENDING', total: 22.45, createdAt: T(2) })
    ).id;
    ids.ticketFailed = (
      await order({ contact: contacts.both, status: 'FAILED', total: 22.45, createdAt: T(2, 13) })
    ).id;
    ids.ticketBoth = (
      await order({
        contact: contacts.both,
        status: 'COMPLETED',
        total: 22.45,
        createdAt: T(6),
        paidAt: T(6),
        intent: `pi_${TAG}_both`,
      })
    ).id;
    // Application orders: paid, payment due, cancelled, offline, waived
    ids.appPaid = (
      await application({
        contact: contacts.vendor,
        businessName: 'Vic Co',
        paymentStatus: 'PAID',
        total: 215.5,
        createdAt: T(3),
        paidAt: T(4),
        intent: `pi_${TAG}_app`,
      })
    ).order.id;
    ids.appDue = (
      await application({
        contact: contacts.both,
        businessName: 'Bo Co',
        paymentStatus: 'PAYMENT_DUE',
        total: 215.5,
        createdAt: T(5),
        dueAt: T(12),
        intent: `pi_${TAG}_declined`,
        session: `cs_${TAG}_paynow`,
      })
    ).order.id;
    ids.appCancelled = (
      await application({
        contact: contacts.vendor,
        businessName: 'Vic Co',
        status: 'REJECTED',
        paymentStatus: 'CARD_ON_FILE',
        total: 215.5,
        createdAt: T(5, 13),
      })
    ).order.id;
    ids.appOffline = (
      await application({
        contact: contacts.buyer,
        businessName: 'Bea Co',
        paymentStatus: 'PARTIALLY_REFUNDED',
        total: 215.5,
        createdAt: T(7),
        paidAt: T(8),
        offline: 'CHEQUE',
        refunds: [{ amount: 15, manual: true, createdAt: T(9) }],
      })
    ).order.id;
    // Someone else's organization
    seq += 1;
    await prisma.order.create({
      data: {
        eventId: otherEvent.id,
        contactId: contacts.stranger.id,
        orderRef: `${TAG.toUpperCase()}-X1`,
        totalAmount: 20,
        subtotalAmount: 20,
        quantity: 1,
        status: 'COMPLETED',
        createdAt: T(1),
        items: { create: { priceTierId: otherTier.id, quantity: 1, unitPrice: 20 } },
      },
    });
  });

  afterAll(async () => {
    for (const o of [org, other]) {
      await prisma.refund
        .deleteMany({ where: { order: { event: { venue: { organizationId: o.id } } } } })
        .catch(() => {});
      await prisma.paymentTransaction
        .deleteMany({ where: { order: { event: { venue: { organizationId: o.id } } } } })
        .catch(() => {});
      await prisma.order
        .deleteMany({ where: { event: { venue: { organizationId: o.id } } } })
        .catch(() => {});
      await prisma.application.deleteMany({ where: { organizationId: o.id } }).catch(() => {});
      await prisma.applicantProfile.deleteMany({ where: { organizationId: o.id } }).catch(() => {});
      await prisma.applicationForm
        .deleteMany({ where: { event: { venue: { organizationId: o.id } } } })
        .catch(() => {});
      await prisma.priceTier
        .deleteMany({ where: { event: { venue: { organizationId: o.id } } } })
        .catch(() => {});
      await prisma.event.deleteMany({ where: { venue: { organizationId: o.id } } }).catch(() => {});
      await prisma.contact.deleteMany({ where: { organizationId: o.id } }).catch(() => {});
      await prisma.venue.deleteMany({ where: { organizationId: o.id } }).catch(() => {});
      await prisma.organization.deleteMany({ where: { id: o.id } }).catch(() => {});
    }
    await cleanupStaff(emails);
  });

  const list = (qs = '', token = adminToken) =>
    request(app)
      .get(`/admin/orders${qs ? `?${qs}` : ''}`)
      .set(...auth(token));
  const refsOf = (res) => res.body.data.map((o) => o.orderRef);

  it('lists both kinds newest first, hides FAILED and CANCELLED by default, and describes each row', async () => {
    const res = await list();
    expect(res.status).toBe(200);
    const rows = res.body.data;
    expect(rows.map((o) => o.id)).toEqual([
      ids.appOffline,
      ids.ticketBoth,
      ids.appDue,
      ids.appPaid,
      ids.ticketPending,
      ids.ticketPaid,
    ]);
    expect(res.body.pagination).toMatchObject({ total: 6, page: 1, limit: 20 });

    const paid = rows.find((o) => o.id === ids.appPaid);
    expect(paid).toMatchObject({
      kind: 'APPLICATION',
      status: 'COMPLETED',
      statusDetail: null,
      businessName: 'Vic Co',
      description: 'Booth',
      paymentSource: 'stripe',
      totalAmount: 215.5,
      refunded: 0,
      net: 215.5,
      quantity: 1,
      eventName: `${TAG} Expo`,
    });
    expect(paid.application).toMatchObject({
      status: 'APPROVED',
      paymentStatus: 'PAID',
      formName: 'Vendors',
      tierName: 'Booth',
    });
    expect(paid.paidAt).toBe(T(4).toISOString());

    const due = rows.find((o) => o.id === ids.appDue);
    expect(due).toMatchObject({
      kind: 'APPLICATION',
      status: 'PENDING',
      statusDetail: {
        paymentStatus: 'PAYMENT_DUE',
        label: 'Payment due',
        dueAt: T(12).toISOString(),
      },
    });

    const offline = rows.find((o) => o.id === ids.appOffline);
    expect(offline).toMatchObject({
      status: 'PARTIALLY_REFUNDED',
      paymentSource: 'offline',
      refunded: 15,
      net: 200.5,
    });

    const ticket = rows.find((o) => o.id === ids.ticketPaid);
    expect(ticket).toMatchObject({
      kind: 'TICKET',
      description: '2 × GA',
      businessName: null,
      statusDetail: null,
      refunded: 10,
      net: 34.9,
      application: null,
    });
    expect(ticket.organization).toBeUndefined();
  });

  it('filters by kind, status (including the hidden ones), event and date range', async () => {
    expect(refsOf(await list('kind=APPLICATION')).length).toBe(3);
    expect((await list('kind=APPLICATION')).body.data.every((o) => o.kind === 'APPLICATION')).toBe(
      true
    );
    expect((await list('kind=TICKET')).body.data.map((o) => o.id)).toEqual([
      ids.ticketBoth,
      ids.ticketPending,
      ids.ticketPaid,
    ]);

    expect((await list('status=CANCELLED')).body.data.map((o) => o.id)).toEqual([ids.appCancelled]);
    expect((await list('status=FAILED,CANCELLED')).body.data.map((o) => o.id).sort()).toEqual(
      [ids.appCancelled, ids.ticketFailed].sort()
    );
    expect((await list('status=COMPLETED')).body.data.map((o) => o.id).sort()).toEqual(
      [ids.appPaid, ids.ticketBoth].sort()
    );
    expect((await list('status=PENDING&kind=APPLICATION')).body.data.map((o) => o.id)).toEqual([
      ids.appDue,
    ]);

    expect((await list(`eventId=${event.id}`)).body.pagination.total).toBe(6);
    expect((await list(`eventId=${otherEvent.id}`)).body.pagination.total).toBe(0);

    expect((await list('from=2026-09-05&to=2026-09-06')).body.data.map((o) => o.id)).toEqual([
      ids.ticketBoth,
      ids.appDue,
    ]);
    expect((await list(`from=${T(7).toISOString()}`)).body.data.map((o) => o.id)).toEqual([
      ids.appOffline,
    ]);

    expect((await list('kind=NOPE')).status).toBe(400);
    expect((await list('status=WEIRD')).status).toBe(400);
    expect((await list('from=2026-09-10&to=2026-09-01')).status).toBe(400);
    expect((await list('limit=500')).status).toBe(400);
  });

  it('searches by order ref, name, email, business name and Stripe ids', async () => {
    expect(
      (await list(`search=${TAG.toUpperCase()}-a`)).body.data.every((o) => o.kind === 'APPLICATION')
    ).toBe(true);
    expect((await list(`search=${TAG.toLowerCase()}-01`)).body.data.map((o) => o.id)).toEqual([
      ids.ticketPaid,
    ]);
    expect((await list('search=Vic')).body.data.map((o) => o.id)).toEqual([ids.appPaid]);
    expect((await list(`search=bea@${TAG}.test`)).body.data.map((o) => o.id).sort()).toEqual(
      [ids.appOffline, ids.ticketPaid].sort()
    );
    expect((await list('search=Bo%20Co')).body.data.map((o) => o.id)).toEqual([ids.appDue]);
    // Stripe ids match exactly, never by substring
    expect((await list(`search=pi_${TAG}_app`)).body.data.map((o) => o.id)).toEqual([ids.appPaid]);
    expect((await list(`search=pi_${TAG}_declined`)).body.data.map((o) => o.id)).toEqual([
      ids.appDue,
    ]);
    expect((await list(`search=re_${TAG}_ticket`)).body.data.map((o) => o.id)).toEqual([
      ids.ticketPaid,
    ]);
    expect((await list(`search=cs_${TAG}_paynow`)).body.data.map((o) => o.id)).toEqual([
      ids.appDue,
    ]);
    expect((await list(`search=pi_${TAG}`)).body.data).toEqual([]);
    // A cancelled order is still findable once the status filter names it
    expect((await list(`search=Vic&status=CANCELLED`)).body.data.map((o) => o.id)).toEqual([
      ids.appCancelled,
    ]);
  });

  it('sorts and pages', async () => {
    const byTotal = await list('sort=totalAmount&dir=desc&limit=2');
    expect(byTotal.body.data.map((o) => o.totalAmount)).toEqual([215.5, 215.5]);
    expect(byTotal.body.pagination).toMatchObject({ totalPages: 3, page: 1 });
    const page3 = await list('sort=totalAmount&dir=desc&limit=2&page=3');
    expect(page3.body.data.map((o) => o.totalAmount)).toEqual([22.45, 22.45]);
    const byPaid = await list('sort=paidAt&dir=asc');
    expect(byPaid.body.data.slice(0, 3).map((o) => o.id)).toEqual([
      ids.ticketPaid,
      ids.appPaid,
      ids.ticketBoth,
    ]);
    expect(byPaid.body.data.slice(-2).every((o) => o.paidAt === null)).toBe(true);
  });

  it('scopes to the organization; ORGANIZER may read; SYSTEM_ADMIN sees every organization with an organization column or one via X-Jump-Org', async () => {
    expect((await list('', organizerToken)).body.pagination.total).toBe(6);
    const all = await list('search=' + TAG.toUpperCase(), sysToken);
    expect(all.status).toBe(200);
    expect(all.body.pagination.total).toBe(7);
    const foreign = all.body.data.find((o) => o.orderRef === `${TAG.toUpperCase()}-X1`);
    expect(foreign.organization).toEqual({ id: other.id, name: other.name });
    const scoped = await request(app)
      .get('/admin/orders')
      .set(...auth(sysToken))
      .set('X-Jump-Org', other.id);
    expect(scoped.body.data.map((o) => o.orderRef)).toEqual([`${TAG.toUpperCase()}-X1`]);
  });

  it('exports CSV with the same filters, one refund line per succeeded refund', async () => {
    const res = await request(app)
      .get(
        '/admin/orders/export.csv?kind=APPLICATION&status=COMPLETED,PARTIALLY_REFUNDED,PENDING,CANCELLED'
      )
      .set(...auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/orders-\d{4}-\d{2}-\d{2}\.csv/);
    const lines = res.text.trim().split('\r\n');
    const header = lines[0].split(',');
    expect(header.slice(0, 9)).toEqual([
      'line',
      'orderRef',
      'kind',
      'status',
      'statusDetail',
      'paymentSource',
      'contactName',
      'contactEmail',
      'businessName',
    ]);
    expect(header).toContain('stripePaymentIntentId');
    expect(header).toContain('stripeRefundId');
    expect(header).not.toContain('organization');
    const rows = lines.slice(1).map((l) => l.split(','));
    // 4 application orders + 1 refund line (the manual cheque refund)
    expect(rows).toHaveLength(5);
    expect(rows.filter((r) => r[0] === 'order').map((r) => r[2])).toEqual([
      'APPLICATION',
      'APPLICATION',
      'APPLICATION',
      'APPLICATION',
    ]);
    const refundLine = rows.find((r) => r[0] === 'refund');
    expect(refundLine.slice(1, 4)).toEqual([
      `${TAG.toUpperCase()}-A08`,
      'APPLICATION',
      'PARTIALLY_REFUNDED',
    ]);
    expect(refundLine[header.indexOf('refunded')]).toBe('15.00');
    expect(refundLine[header.indexOf('stripeRefundId')]).toBe('manual');
    const dueLine = rows.find((r) => r[1] === `${TAG.toUpperCase()}-A06`);
    expect(dueLine[header.indexOf('statusDetail')]).toBe('Payment due');
    expect(dueLine[header.indexOf('stripePaymentIntentId')]).toBe(`pi_${TAG}_declined`);
    expect(dueLine[header.indexOf('stripeCheckoutSessionId')]).toBe(`cs_${TAG}_paynow`);

    const sys = await request(app)
      .get(`/admin/orders/export.csv?search=${TAG.toUpperCase()}-X1`)
      .set(...auth(sysToken));
    expect(sys.text.split('\r\n')[0].split(',')).toContain('organization');
    expect(sys.text.split('\r\n')[1]).toContain(other.name);

    expect(
      (
        await request(app)
          .get('/admin/orders/export.csv?kind=NOPE')
          .set(...auth(adminToken))
      ).status
    ).toBe(400);
  });

  it("buyer's own orders include application orders with the application id, never failed or cancelled ones", async () => {
    const session = buyerAuthService.signSession({
      contactId: contacts.both.id,
      organizationId: org.id,
      email: contacts.both.email,
    });
    const res = await request(app)
      .get('/buyer/me/orders')
      .set(...auth(session));
    expect(res.status).toBe(200);
    expect(res.body.data.map((o) => o.id)).toEqual([ids.ticketBoth, ids.appDue, ids.ticketPending]);
    const due = res.body.data.find((o) => o.id === ids.appDue);
    expect(due).toMatchObject({
      kind: 'APPLICATION',
      applicationId: expect.any(String),
      description: 'Booth',
      statusDetail: { label: 'Payment due' },
    });
  });
});
