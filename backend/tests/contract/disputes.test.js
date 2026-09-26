// Contract tests for Stripe disputes / chargebacks (spec 037)
//
// Every fixture is posted to the real POST /webhooks/stripe with a real
// signature (STRIPE_WEBHOOK_SECRET set, no route stubbing), and **every one is
// replayed twice** — Stripe redelivers these, and `.closed` can arrive before
// `.funds_withdrawn`, so idempotency and ordering are the whole point. The
// assertions after the second delivery are the same as after the first.
//
// Postgres is real. Resend is mocked so the organizer notification can be
// counted. Stripe is NOT mocked: the fixtures carry `payment_intent`, so no
// Stripe API call is made, and the signing helper is the library's own.

import { jest } from '@jest/globals';
import request from 'supertest';
import Stripe from 'stripe';

const sentEmails = [];
jest.unstable_mockModule('../../src/config/resend.js', () => ({
  default: { emails: { send: jest.fn(async (msg) => { sentEmails.push(msg); return { id: 'mock' }; }) } },
}));

process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_disputes_contract';
const SECRET = 'whsec_disputes_contract_secret';
const previousSecret = process.env.STRIPE_WEBHOOK_SECRET;
process.env.STRIPE_WEBHOOK_SECRET = SECRET;

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');
const { default: disputeService } = await import('../../src/services/DisputeService.js');

const TAG = 'dispute-ct';
const T0 = Math.floor(Date.parse('2026-05-01T00:00:00Z') / 1000);

/** Post one event with a valid signature — the only write path into the ledger. */
async function deliver(event) {
  const payload = JSON.stringify(event);
  const res = await request(app)
    .post('/webhooks/stripe')
    .set('stripe-signature', Stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET }))
    .set('Content-Type', 'application/json')
    .send(payload);
  expect(res.status).toBe(200);
  return res;
}

/** Deliver the same event twice. Stripe does; so must the test. */
async function deliverTwice(event) {
  await deliver(event);
  await deliver(event);
}

let seq = 0;
/**
 * A Stripe dispute event. `withdrawn` / `reinstated` drive
 * `balance_transactions`, which is what the handler actually reads — the event
 * type is only a label.
 */
function disputeEvent(type, { disputeId, paymentIntent, chargeId, amountCents, status, createdOffset = 0, withdrawn = false, reinstated = false, reason = 'fraudulent' }) {
  const balance_transactions = [];
  if (withdrawn) balance_transactions.push({ id: `txn_w_${disputeId}`, amount: -amountCents, reporting_category: 'dispute' });
  if (reinstated) balance_transactions.push({ id: `txn_r_${disputeId}`, amount: amountCents, reporting_category: 'dispute_reversal' });
  return {
    id: `evt_${TAG}_${(seq += 1)}`,
    object: 'event',
    type,
    created: T0 + createdOffset,
    data: {
      object: {
        id: disputeId,
        object: 'dispute',
        amount: amountCents,
        currency: 'usd',
        charge: chargeId,
        payment_intent: paymentIntent,
        reason,
        status,
        balance_transactions,
        evidence_details: { due_by: T0 + 86400 * 7 },
      },
    },
  };
}

describe('Stripe disputes contract (spec 037)', () => {
  let org;
  let venue;
  let event;
  let tier;
  let contact;
  /** @type {Record<string, { order: any, tickets: any[] }>} */
  const fixtures = {};

  /** A COMPLETED ticket order with a SUCCEEDED payment and `count` VALID tickets. */
  async function makeOrder(key, { unitPrice = 50, count = 2 } = {}) {
    const total = unitPrice * count;
    const order = await prisma.order.create({
      data: {
        eventId: event.id,
        contactId: contact.id,
        orderRef: `${TAG}-${key}`,
        totalAmount: total,
        subtotalAmount: total,
        quantity: count,
        status: 'COMPLETED',
        paidAt: new Date(),
      },
    });
    await prisma.paymentTransaction.create({
      data: { orderId: order.id, stripePaymentIntentId: `pi_${TAG}_${key}`, amount: total, status: 'SUCCEEDED' },
    });
    const tickets = [];
    for (let i = 0; i < count; i += 1) {
      tickets.push(
        await prisma.ticket.create({
          data: {
            orderId: order.id,
            eventId: event.id,
            priceTierId: tier.id,
            contactId: contact.id,
            ticketNumber: (fixtures.__n = (fixtures.__n || 0) + 1),
            pricePaid: unitPrice,
            barcode: `${TAG}-${key}-${i}`,
          },
        })
      );
    }
    await prisma.priceTier.update({ where: { id: tier.id }, data: { quantitySold: { increment: count } } });
    fixtures[key] = { order, tickets };
    return fixtures[key];
  }

  const tierSold = async () => (await prisma.priceTier.findUnique({ where: { id: tier.id } })).quantitySold;
  const orderStatus = async (key) => (await prisma.order.findUnique({ where: { id: fixtures[key].order.id } })).status;
  const ticketStatuses = async (key) =>
    (await prisma.ticket.findMany({ where: { orderId: fixtures[key].order.id }, orderBy: { ticketNumber: 'asc' } })).map((t) => t.status);
  const liveRefunds = async (key) =>
    prisma.refund.findMany({ where: { orderId: fixtures[key].order.id, status: 'SUCCEEDED' } });
  const disputeRows = async (key) => prisma.dispute.findMany({ where: { orderId: fixtures[key].order.id } });

  beforeAll(async () => {
    org = await prisma.organization.create({ data: { name: `${TAG} Chargeback Hall` } });
    // A member, so the organizer notification has somewhere to go.
    await prisma.user.create({
      data: { email: `organizer@${TAG}.test`, role: 'ADMIN', memberships: { create: { organizationId: org.id, role: 'ADMIN' } } },
    });
    venue = await prisma.venue.create({ data: { organizationId: org.id, name: `${TAG} Venue`, address: '1 Main St', state: 'NY' } });
    event = await prisma.event.create({ data: { venueId: venue.id, name: `${TAG} Show`, date: new Date('2026-06-01T20:00:00Z'), capacity: 500 } });
    tier = await prisma.priceTier.create({ data: { eventId: event.id, name: 'GA', price: 50, quantityTotal: 500 } });
    contact = await prisma.contact.create({ data: { organizationId: org.id, email: `buyer@${TAG}.test`, firstName: 'Dana', lastName: 'Buyer' } });

    await makeOrder('lost');
    await makeOrder('won');
    await makeOrder('ooo');
    await makeOrder('inquiry');
  });

  afterAll(async () => {
    const orderIds = Object.values(fixtures).filter((f) => f?.order).map((f) => f.order.id);
    await prisma.refund.deleteMany({ where: { orderId: { in: orderIds } } }).catch(() => {});
    await prisma.dispute.deleteMany({ where: { orderId: { in: orderIds } } }).catch(() => {});
    await prisma.ticket.deleteMany({ where: { orderId: { in: orderIds } } }).catch(() => {});
    await prisma.paymentTransaction.deleteMany({ where: { orderId: { in: orderIds } } }).catch(() => {});
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } }).catch(() => {});
    await prisma.application.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.applicantProfile.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.applicationForm.deleteMany({ where: { eventId: event.id } }).catch(() => {});
    await prisma.priceTier.deleteMany({ where: { eventId: event.id } }).catch(() => {});
    await prisma.event.deleteMany({ where: { id: event.id } }).catch(() => {});
    await prisma.contact.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.venue.deleteMany({ where: { id: venue.id } }).catch(() => {});
    await prisma.user.deleteMany({ where: { email: { endsWith: `@${TAG}.test` } } }).catch(() => {});
    await prisma.organization.deleteMany({ where: { id: org.id } }).catch(() => {});
    process.env.STRIPE_WEBHOOK_SECRET = previousSecret ?? '';
  });

  beforeEach(() => {
    sentEmails.length = 0;
  });

  // ── created ────────────────────────────────────────────────────────────────

  it('records charge.dispute.created and notifies the organizer once, without touching the money', async () => {
    const soldBefore = await tierSold();
    await deliverTwice(
      disputeEvent('charge.dispute.created', {
        disputeId: `dp_${TAG}_lost`,
        paymentIntent: `pi_${TAG}_lost`,
        chargeId: `ch_${TAG}_lost`,
        amountCents: 10000,
        status: 'needs_response',
      })
    );

    const rows = await disputeRows('lost');
    expect(rows).toHaveLength(1); // two deliveries, one row
    expect(rows[0]).toMatchObject({ state: 'OPEN', inquiry: false, fundsWithdrawn: false, reason: 'fraudulent' });
    expect(Number(rows[0].amount)).toBe(100);
    expect(rows[0].stripePaymentIntentId).toBe(`pi_${TAG}_lost`);

    // Nothing has moved yet: Stripe is still holding nothing.
    expect(await liveRefunds('lost')).toHaveLength(0);
    expect(await orderStatus('lost')).toBe('COMPLETED');
    expect(await ticketStatuses('lost')).toEqual(['VALID', 'VALID']);
    expect(await tierSold()).toBe(soldBefore);

    // One email for the transition, not one per delivery.
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].subject).toMatch(/Chargeback opened on order dispute-ct-lost/);
    expect(sentEmails[0].to).toEqual([`organizer@${TAG}.test`]);
  });

  // ── funds_withdrawn ────────────────────────────────────────────────────────

  it('projects funds_withdrawn as one Refund row, voids the tickets and restores inventory exactly once', async () => {
    const soldBefore = await tierSold();
    await deliverTwice(
      disputeEvent('charge.dispute.funds_withdrawn', {
        disputeId: `dp_${TAG}_lost`,
        paymentIntent: `pi_${TAG}_lost`,
        chargeId: `ch_${TAG}_lost`,
        amountCents: 10000,
        status: 'under_review',
        createdOffset: 60,
        withdrawn: true,
      })
    );

    const rows = await disputeRows('lost');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ state: 'OPEN', fundsWithdrawn: true });
    expect(rows[0].voidedTickets).toHaveLength(2);

    const refunds = await liveRefunds('lost');
    expect(refunds).toHaveLength(1); // the money-out row, once
    expect(Number(refunds[0].amount)).toBe(100);
    expect(refunds[0].disputeId).toBe(rows[0].id);
    expect(refunds[0].stripeRefundId).toBeNull(); // a chargeback has no Stripe Refund object
    expect(refunds[0].reason).toBe('Chargeback: fraudulent');

    expect(await ticketStatuses('lost')).toEqual(['VOIDED', 'VOIDED']);
    expect(await tierSold()).toBe(soldBefore - 2); // decremented once, not twice
    expect(await orderStatus('lost')).toBe('REFUNDED');

    // An `updated` event with the same ledger must change nothing at all.
    await deliverTwice(
      disputeEvent('charge.dispute.updated', {
        disputeId: `dp_${TAG}_lost`,
        paymentIntent: `pi_${TAG}_lost`,
        chargeId: `ch_${TAG}_lost`,
        amountCents: 10000,
        status: 'under_review',
        createdOffset: 120,
        withdrawn: true,
      })
    );
    expect(await liveRefunds('lost')).toHaveLength(1);
    expect(await tierSold()).toBe(soldBefore - 2);
  });

  // ── closed (lost) ──────────────────────────────────────────────────────────

  it('closes a lost dispute without double-charging the order', async () => {
    const soldBefore = await tierSold();
    await deliverTwice(
      disputeEvent('charge.dispute.closed', {
        disputeId: `dp_${TAG}_lost`,
        paymentIntent: `pi_${TAG}_lost`,
        chargeId: `ch_${TAG}_lost`,
        amountCents: 10000,
        status: 'lost',
        createdOffset: 180,
        withdrawn: true,
      })
    );

    const rows = await disputeRows('lost');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ state: 'LOST', fundsWithdrawn: true });
    expect(rows[0].closedAt).not.toBeNull();

    expect(await liveRefunds('lost')).toHaveLength(1);
    expect(await ticketStatuses('lost')).toEqual(['VOIDED', 'VOIDED']);
    expect(await tierSold()).toBe(soldBefore);
    expect(await orderStatus('lost')).toBe('REFUNDED');

    // One "lost" email for the state change, not one per delivery.
    expect(sentEmails.filter((e) => /Chargeback lost/.test(e.subject))).toHaveLength(1);
  });

  it('a lost dispute still counts the order as money collected, offset by the dispute row', async () => {
    // Spec 037 deliberately reuses REFUNDED instead of adding an OrderStatus:
    // the order row already reports net 0, and `dispute` says why.
    const order = await prisma.order.findUnique({
      where: { id: fixtures.lost.order.id },
      include: { refunds: { where: { status: 'SUCCEEDED' } }, disputes: true },
    });
    const refunded = order.refunds.reduce((sum, r) => sum + Number(r.amount), 0);
    expect(refunded).toBe(Number(order.totalAmount));
    expect(order.disputes).toHaveLength(1);
    expect(order.disputes[0].state).toBe('LOST');
  });

  // ── closed (won) ───────────────────────────────────────────────────────────

  it('a won dispute reverses the money-out row and restores the tickets it voided', async () => {
    // This order's chargeback arrives with the withdrawal already on the
    // `created` event, which is what a real US card dispute looks like.
    const redeemed = fixtures.won.tickets[1];
    await prisma.ticket.update({ where: { id: redeemed.id }, data: { status: 'REDEEMED', redeemedAt: new Date() } });

    const soldBeforeDispute = await tierSold();
    await deliverTwice(
      disputeEvent('charge.dispute.created', {
        disputeId: `dp_${TAG}_won`,
        paymentIntent: `pi_${TAG}_won`,
        chargeId: `ch_${TAG}_won`,
        amountCents: 10000,
        status: 'needs_response',
        createdOffset: 200,
        withdrawn: true,
      })
    );
    expect(await ticketStatuses('won')).toEqual(['VOIDED', 'VOIDED']);
    expect(await tierSold()).toBe(soldBeforeDispute - 2);
    expect(await orderStatus('won')).toBe('REFUNDED');
    expect(await liveRefunds('won')).toHaveLength(1);

    await deliverTwice(
      disputeEvent('charge.dispute.closed', {
        disputeId: `dp_${TAG}_won`,
        paymentIntent: `pi_${TAG}_won`,
        chargeId: `ch_${TAG}_won`,
        amountCents: 10000,
        status: 'won',
        createdOffset: 260,
        withdrawn: true,
        reinstated: true,
      })
    );

    const rows = await disputeRows('won');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ state: 'WON', fundsWithdrawn: false });

    // The money-out row stops counting; the ledger keeps the trail.
    expect(await liveRefunds('won')).toHaveLength(0);
    const all = await prisma.refund.findMany({ where: { orderId: fixtures.won.order.id } });
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe('FAILED');
    expect(all[0].disputeId).toBe(rows[0].id);

    // The redeemed ticket comes back redeemed, not as a fresh VALID scan.
    expect(await ticketStatuses('won')).toEqual(['VALID', 'REDEEMED']);
    expect(await tierSold()).toBe(soldBeforeDispute); // restored once, not twice
    expect(await orderStatus('won')).toBe('COMPLETED');
    expect(sentEmails.filter((e) => /Chargeback reversed/.test(e.subject))).toHaveLength(1);
  });

  // ── ordering ───────────────────────────────────────────────────────────────

  it('ignores a funds_withdrawn that arrives after the dispute was already won', async () => {
    // The hazard the monotonic guard exists for: Stripe does not promise order.
    await deliverTwice(
      disputeEvent('charge.dispute.closed', {
        disputeId: `dp_${TAG}_ooo`,
        paymentIntent: `pi_${TAG}_ooo`,
        chargeId: `ch_${TAG}_ooo`,
        amountCents: 10000,
        status: 'won',
        createdOffset: 400, // newer
        withdrawn: true,
        reinstated: true,
      })
    );
    expect(await orderStatus('ooo')).toBe('COMPLETED');
    expect(await liveRefunds('ooo')).toHaveLength(0);
    const soldAfterWin = await tierSold();

    await deliverTwice(
      disputeEvent('charge.dispute.funds_withdrawn', {
        disputeId: `dp_${TAG}_ooo`,
        paymentIntent: `pi_${TAG}_ooo`,
        chargeId: `ch_${TAG}_ooo`,
        amountCents: 10000,
        status: 'under_review',
        createdOffset: 300, // strictly older — must not move state
        withdrawn: true,
      })
    );

    const rows = await disputeRows('ooo');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ state: 'WON', fundsWithdrawn: false, lastEventType: 'charge.dispute.closed' });
    expect(await liveRefunds('ooo')).toHaveLength(0);
    expect(await orderStatus('ooo')).toBe('COMPLETED');
    expect(await ticketStatuses('ooo')).toEqual(['VALID', 'VALID']);
    expect(await tierSold()).toBe(soldAfterWin);
  });

  // ── inquiry ────────────────────────────────────────────────────────────────

  it('records an inquiry without voiding tickets or moving money', async () => {
    const soldBefore = await tierSold();
    await deliverTwice(
      disputeEvent('charge.dispute.created', {
        disputeId: `dp_${TAG}_inq`,
        paymentIntent: `pi_${TAG}_inquiry`,
        chargeId: `ch_${TAG}_inquiry`,
        amountCents: 10000,
        status: 'warning_needs_response',
        createdOffset: 500,
        reason: 'general',
      })
    );

    const rows = await disputeRows('inquiry');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ inquiry: true, state: 'OPEN', fundsWithdrawn: false });
    expect(await liveRefunds('inquiry')).toHaveLength(0);
    expect(await ticketStatuses('inquiry')).toEqual(['VALID', 'VALID']);
    expect(await orderStatus('inquiry')).toBe('COMPLETED');
    expect(await tierSold()).toBe(soldBefore);
    expect(sentEmails[0].text).toMatch(/inquiry, not yet a chargeback/);
  });

  // ── application orders (vendor booth) ──────────────────────────────────────

  it('moves an application order and its paymentStatus together, both ways', async () => {
    // Spec 024: a PAID-form application *is* an order, so a vendor chargeback
    // must move Application.paymentStatus and Order.status in one write — and
    // put both back when the dispute is won.
    const form = await prisma.applicationForm.create({
      data: { eventId: event.id, kind: 'PAID', name: `${TAG} Vendors`, slug: `${TAG}-vendors`, status: 'OPEN' },
    });
    const appTier = await prisma.applicationTier.create({ data: { formId: form.id, name: 'Booth', price: 100, quantityTotal: 10, quantityApproved: 1 } });
    const profile = await prisma.applicantProfile.create({ data: { organizationId: org.id, contactId: contact.id, businessName: `${TAG} Hot Sauce` } });
    const application = await prisma.application.create({
      data: {
        formId: form.id,
        eventId: event.id,
        organizationId: org.id,
        contactId: contact.id,
        profileId: profile.id,
        tierId: appTier.id,
        status: 'APPROVED',
        paymentStatus: 'PAID',
        capacitySlot: 'APPROVED',
        statusTokenHash: `${TAG}-booth-token`,
      },
    });
    const order = await prisma.order.create({
      data: {
        kind: 'APPLICATION',
        applicationId: application.id,
        eventId: event.id,
        contactId: contact.id,
        orderRef: `${TAG}-booth`,
        totalAmount: 100,
        subtotalAmount: 100,
        quantity: 1,
        status: 'COMPLETED',
        paidAt: new Date(),
      },
    });
    await prisma.paymentTransaction.create({
      data: { orderId: order.id, stripePaymentIntentId: `pi_${TAG}_booth`, amount: 100, status: 'SUCCEEDED' },
    });
    fixtures.booth = { order, tickets: [] };

    const lost = (offset) => ({
      disputeId: `dp_${TAG}_booth`,
      paymentIntent: `pi_${TAG}_booth`,
      chargeId: `ch_${TAG}_booth`,
      amountCents: 10000,
      createdOffset: offset,
    });

    await deliverTwice(disputeEvent('charge.dispute.closed', { ...lost(700), status: 'lost', withdrawn: true }));
    let after = await prisma.application.findUnique({ where: { id: application.id }, include: { order: true } });
    expect(after.paymentStatus).toBe('REFUNDED');
    expect(after.order.status).toBe('REFUNDED');
    expect(await liveRefunds('booth')).toHaveLength(1);

    // Won on appeal: the money is back, so both states go back with it.
    await deliverTwice(disputeEvent('charge.dispute.closed', { ...lost(800), status: 'won', withdrawn: true, reinstated: true }));
    after = await prisma.application.findUnique({ where: { id: application.id }, include: { order: true } });
    expect(after.paymentStatus).toBe('PAID');
    expect(after.order.status).toBe('COMPLETED');
    expect(await liveRefunds('booth')).toHaveLength(0);
  });

  // ── unresolvable ───────────────────────────────────────────────────────────

  it('answers 200 and writes nothing for a dispute on a payment Jump never recorded', async () => {
    await deliverTwice(
      disputeEvent('charge.dispute.created', {
        disputeId: `dp_${TAG}_alien`,
        paymentIntent: `pi_${TAG}_not_ours`,
        chargeId: `ch_${TAG}_not_ours`,
        amountCents: 500,
        status: 'needs_response',
        createdOffset: 600,
      })
    );
    expect(await prisma.dispute.count({ where: { stripeDisputeId: `dp_${TAG}_alien` } })).toBe(0);
    expect(sentEmails).toHaveLength(0);
  });

  // ── reconciliation, both directions ────────────────────────────────────────

  it('reconciles every dispute to exactly one order and back', async () => {
    const report = await disputeService.reconcile({ organizationId: org.id });
    expect(report.disputes).toBe(5); // lost, won, ooo, inquiry, booth — the alien one was never written
    expect(report.orders).toBe(5); // one order each, counted the other way
    expect(report.withMoneyOut).toBe(1); // only the lost one is still holding money
    expect(report.missingProjection).toEqual([]);
    expect(report.orphanProjections).toEqual([]);
    expect(report.danglingRefunds).toBe(0);
    expect(report.multiOrder).toBe(0);
    expect(report.clean).toBe(true);
  });

  it('surfaces the dispute on the admin order row so a chargeback is not read as a refund', async () => {
    const { default: orderService } = await import('../../src/services/OrderService.js');
    const { data } = await orderService.getOrdersByOrganization(org.id, { search: `${TAG}-lost` });
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({ status: 'REFUNDED', refunded: 100, net: 0 });
    expect(data[0].dispute).toMatchObject({ state: 'LOST', amount: 100, fundsWithdrawn: true, inquiry: false });
  });
});
