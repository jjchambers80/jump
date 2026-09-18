// Contract tests for application corrections (spec 018 phase 3): an
// application's money before it moves — tier change, manual adjustments,
// waived balance, offline payment, manual refund — and how customers and
// analytics report them. Stripe and Resend mocked; Postgres is real.

import { jest } from '@jest/globals';
import request from 'supertest';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';

const sentEmails = [];
jest.unstable_mockModule('../../src/config/resend.js', () => ({
  default: { emails: { send: jest.fn(async (msg) => { sentEmails.push(msg); return { id: 'mock' }; }) } },
}));

const mockSessionsCreate = jest.fn();
const mockSessionsExpire = jest.fn();
const mockCustomersCreate = jest.fn();
const mockIntentsCreate = jest.fn();
const mockRefundsCreate = jest.fn();
jest.unstable_mockModule('../../src/config/stripe.js', () => ({
  default: {
    checkout: { sessions: { create: mockSessionsCreate, retrieve: jest.fn(), expire: mockSessionsExpire } },
    customers: { create: mockCustomersCreate },
    paymentIntents: { create: mockIntentsCreate, retrieve: jest.fn().mockResolvedValue({ transfer_data: null, application_fee_amount: null }) },
    setupIntents: { retrieve: jest.fn(async (id) => ({ id, payment_method: `pm_${id}` })) },
    refunds: { create: mockRefundsCreate },
    charges: { retrieve: jest.fn() },
    webhooks: { constructEvent: jest.fn() },
  },
}));

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');
const { default: paymentSettingsService } = await import('../../src/services/PaymentSettingsService.js');
const { applicationAmounts, applicationLines } = await import('../../src/services/ApplicationFormService.js');

const TAG = 'appcorr';
paymentSettingsService._statusCache = {
  value: { provider: 'STRIPE', mode: 'test', charges: 'active', statementDescriptorPrefix: 'JUMP', capabilities: { link: 'active', cashapp: null, affirm: null, klarna: null, afterpay_clearpay: null }, manageUrl: '', radarUrl: '', error: null },
  expiresAt: Number.POSITIVE_INFINITY,
};

let n = 0;
function resetStripeMocks() {
  mockSessionsCreate.mockReset().mockImplementation(async (params) => ({ id: `cs_${TAG}_${++n}`, url: `https://checkout.stripe.com/c/pay/cs_${TAG}_${n}`, mode: params.mode, metadata: params.metadata }));
  mockSessionsExpire.mockReset().mockResolvedValue({});
  mockCustomersCreate.mockReset().mockImplementation(async () => ({ id: `cus_${TAG}_${++n}` }));
  mockIntentsCreate.mockReset().mockImplementation(async () => ({ id: `pi_${TAG}_${++n}`, status: 'succeeded' }));
  mockRefundsCreate.mockReset().mockImplementation(async (params) => ({ id: `re_${TAG}_${++n}`, amount: params.amount, status: 'succeeded' }));
}

function cardDecline() {
  const err = new Error('Your card was declined.');
  err.type = 'StripeCardError';
  err.code = 'card_declined';
  err.raw = { payment_intent: { id: `pi_${TAG}_declined_${++n}` } };
  return err;
}

const webhook = (event) => request(app).post('/webhooks/stripe').set('Content-Type', 'application/json').send(JSON.stringify(event));
const checkoutCompleted = (session) => ({ id: `evt_${Math.random()}`, type: 'checkout.session.completed', data: { object: session } });

describe('Application corrections contract (spec 018 phase 3)', () => {
  let adminToken;
  let organizerToken;
  let org;
  let eventId;
  let event;
  let form;
  let booth; // $275, 5 slots
  let corner; // $400, 1 slot
  let power; // all tiers, $125
  let badge; // Booth only, $10
  const emails = [`admin@${TAG}.test`, `organizer@${TAG}.test`];
  const auth = (token) => ['Authorization', `Bearer ${token}`];
  const adminBase = () => `/admin/events/${eventId}`;

  const submit = (tierId, email, addOns, businessName = 'Pixel Pins') =>
    request(app)
      .post(`/events/${eventId}/applications`)
      .send({ formSlug: form.slug, tierId, contact: { email, firstName: 'Vee', lastName: 'Vendor' }, profile: { businessName }, answers: {}, ...(addOns !== undefined && { addOns }) });

  const appRow = (id) => prisma.application.findUnique({ where: { id }, include: { tier: true, contact: true, addOns: { include: { addOn: true } }, decisions: true, adjustments: true, refunds: true } });
  const tierRow = (id) => prisma.applicationTier.findUnique({ where: { id } });
  const addOnRow = (id) => prisma.addOn.findUnique({ where: { id } });

  async function cardOnFile(applicationId) {
    const row = await appRow(applicationId);
    const res = await webhook(checkoutCompleted({ id: row.stripeCheckoutSessionId, mode: 'setup', setup_intent: `seti_${applicationId}`, customer: row.contact.stripeCustomerId, metadata: { applicationId, purpose: 'submit' } }));
    expect(res.status).toBe(200);
    return appRow(applicationId);
  }

  /** A SUBMITTED application with a card on file, optionally with add-ons. */
  async function submitted(tierId, email, addOns, businessName) {
    const res = await submit(tierId, email, addOns, businessName);
    expect(res.status).toBe(201);
    await cardOnFile(res.body.applicationId);
    return res.body.applicationId;
  }

  /** Approve with a declined card → APPROVED + PAYMENT_DUE with the slot reserved. */
  async function paymentDue(tierId, email, addOns, businessName) {
    const id = await submitted(tierId, email, addOns, businessName);
    mockIntentsCreate.mockRejectedValueOnce(cardDecline());
    const res = await decide(id, 'APPROVE');
    expect(res.status).toBe(200);
    expect(res.body.paymentStatus).toBe('PAYMENT_DUE');
    return id;
  }

  const decide = (id, decision, token = organizerToken) => request(app).post(`${adminBase()}/applications/${id}/decision`).set(...auth(token)).send({ decision });
  const changeTier = (id, tierId, token = organizerToken) => request(app).post(`${adminBase()}/applications/${id}/tier`).set(...auth(token)).send({ tierId });
  const adjust = (id, body, token = organizerToken) => request(app).post(`${adminBase()}/applications/${id}/adjustments`).set(...auth(token)).send(body);
  const waive = (id, body, token = adminToken) => request(app).post(`${adminBase()}/applications/${id}/waive`).set(...auth(token)).send(body);
  const offline = (id, body, token = adminToken) => request(app).post(`${adminBase()}/applications/${id}/offline-payment`).set(...auth(token)).send(body);
  const detail = (id) => request(app).get(`${adminBase()}/applications/${id}`).set(...auth(organizerToken));

  const expectedAmounts = async (tierId, lines, adjustmentTotal = 0) => {
    const tier = await tierRow(tierId);
    const organization = await prisma.organization.findUnique({ where: { id: org.id } });
    return applicationAmounts(applicationLines(tier, form, lines, adjustmentTotal), form, event, organization);
  };

  beforeAll(async () => {
    process.env.APPLICATIONS_PAYMENTS_ENABLED = 'true';
    await prisma.organization.deleteMany({ where: { name: { startsWith: `${TAG} ` } } }).catch(() => {});
    adminToken = await staffToken({ email: emails[0], role: 'ADMIN' });
    organizerToken = await staffToken({ email: emails[1], role: 'ORGANIZER' });
    org = await prisma.organization.create({ data: { name: `${TAG} Makers`, email: `owner@${TAG}.test` } });
    await joinOrgByToken(adminToken, org.id, 'ADMIN');
    await joinOrgByToken(organizerToken, org.id, 'ORGANIZER');
    const venue = await prisma.venue.create({ data: { organizationId: org.id, name: `${TAG} Hall`, address: '1 Maker Way', city: 'Durham', state: 'NC' } });
    event = await prisma.event.create({ data: { venueId: venue.id, name: `${TAG} Fair 2027`, date: new Date('2027-10-02T15:00:00Z'), status: 'PUBLISHED', capacity: 500, taxRate: 0.1 } });
    eventId = event.id;

    const f = await request(app)
      .post(`${adminBase()}/application-forms`)
      .set(...auth(adminToken))
      .send({ kind: 'PAID', name: 'Vendor Booth', chargeTiming: 'APPROVAL', taxable: true, paymentDueDays: 5, tiers: [{ name: 'Booth', price: 275, quantityTotal: 5 }, { name: 'Corner', price: 400, quantityTotal: 1 }] });
    expect(f.status).toBe(201);
    form = f.body;
    booth = form.tiers.find((t) => t.name === 'Booth');
    corner = form.tiers.find((t) => t.name === 'Corner');
    expect((await request(app).patch(`${adminBase()}/application-forms/${form.id}`).set(...auth(adminToken)).send({ status: 'OPEN' })).status).toBe(200);

    const create = (body) => request(app).post(`/organizations/${org.id}/events/${eventId}/add-ons`).set(...auth(adminToken)).send(body);
    power = (await create({ name: 'Booth power', price: 125, scope: 'APPLICATION', quantityTotal: 3, taxable: false })).body;
    badge = (await create({ name: 'Extra vendor badge', price: 10, scope: 'APPLICATION', allTiers: false, maxPerOrder: 4, taxable: false })).body;
    expect(power.id && badge.id).toBeTruthy();
    expect((await request(app).put(`${adminBase()}/application-forms/${form.id}/tiers/${booth.id}/add-ons`).set(...auth(adminToken)).send({ addOnIds: [badge.id] })).status).toBe(200);
  });

  afterAll(async () => {
    delete process.env.APPLICATIONS_PAYMENTS_ENABLED;
    await prisma.applicationRefund.deleteMany({ where: { application: { organizationId: org.id } } }).catch(() => {});
    await prisma.application.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.applicantProfile.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.event.deleteMany({ where: { venue: { organizationId: org.id } } }).catch(() => {});
    await prisma.contact.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.venue.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.organization.deleteMany({ where: { id: org.id } }).catch(() => {});
    await cleanupStaff(emails);
    paymentSettingsService._invalidate();
  });

  beforeEach(() => {
    sentEmails.length = 0;
    resetStripeMocks();
  });

  // ─── Tier change ─────────────────────────────────────────────────────────

  it('tier change on SUBMITTED recomputes the snapshot, keeps offered add-ons, drops the rest, records TIER_CHANGED and emails', async () => {
    const id = await submitted(booth.id, `tier1@${TAG}.test`, [{ addOnId: power.id, quantity: 1 }, { addOnId: badge.id, quantity: 2 }]);
    const before = await appRow(id);
    expect(before.addOns).toHaveLength(2);

    const same = await changeTier(id, booth.id);
    expect(same.status).toBe(400);
    const unknown = await changeTier(id, 'nope');
    expect(unknown.status).toBe(404);

    sentEmails.length = 0;
    const res = await changeTier(id, corner.id);
    expect(res.status).toBe(200);
    expect(res.body.tier).toMatchObject({ id: corner.id, name: 'Corner' });
    // Badge is Booth-only → dropped; power is offered on every tier → kept.
    expect(res.body.addOns.map((l) => l.addOnId)).toEqual([power.id]);
    const expected = await expectedAmounts(corner.id, [{ addOn: await addOnRow(power.id), quantity: 1 }]);
    expect(res.body.amounts.applicantPays).toBeCloseTo(expected.applicantPays, 2);
    expect(res.body.amounts.applicantPays).toBeGreaterThan(Number(before.applicantPays));
    const decision = res.body.decisions.at(-1);
    expect(decision.action).toBe('TIER_CHANGED');
    expect(decision.note).toContain('Tier: Booth → Corner');
    expect(decision.note).toContain('Dropped add-ons: Extra vendor badge ×2');
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].subject).toContain('moved to Corner');
    expect(decision.emailSubject).toContain('moved to Corner');
    // Nothing is held for a SUBMITTED application.
    expect((await tierRow(corner.id)).quantityReserved).toBe(0);

    // Approval charges the new amount.
    const approved = await decide(id, 'APPROVE');
    expect(approved.status).toBe(200);
    expect(approved.body.paymentStatus).toBe('PAID');
    expect(mockIntentsCreate.mock.calls[0][0].amount).toBe(Math.round(expected.applicantPays * 100));
    expect((await tierRow(corner.id)).quantityApproved).toBe(1);

    // Once PAID the tier is locked.
    const locked = await changeTier(id, booth.id);
    expect(locked.status).toBe(409);
    expect(locked.body.message).toMatch(/Already paid/);
    // Free the single Corner slot for the next test.
    expect((await decide(id, 'WITHDRAW')).status).toBe(200);
    expect((await tierRow(corner.id)).quantityApproved).toBe(0);
  });

  it('tier change on PAYMENT_DUE moves the reserved slot and add-on holds; a full tier is 409 and nothing changes', async () => {
    const id = await paymentDue(booth.id, `tier2@${TAG}.test`, [{ addOnId: power.id, quantity: 1 }]);
    const boothBefore = await tierRow(booth.id);
    const powerBefore = await addOnRow(power.id);
    expect(boothBefore.quantityReserved).toBeGreaterThanOrEqual(1);
    expect(powerBefore.quantityReserved).toBeGreaterThanOrEqual(1);
    const row = await appRow(id);
    expect(row.capacitySlot).toBe('RESERVED');
    // Mint a pay-now session so the change has something to expire.
    await prisma.application.update({ where: { id }, data: { stripeCheckoutSessionId: `cs_${TAG}_stale` } });

    const res = await changeTier(id, corner.id);
    expect(res.status).toBe(200);
    expect((await tierRow(booth.id)).quantityReserved).toBe(boothBefore.quantityReserved - 1);
    expect((await tierRow(corner.id)).quantityReserved).toBe(1);
    expect((await addOnRow(power.id)).quantityReserved).toBe(powerBefore.quantityReserved); // released and re-held
    expect((await appRow(id)).capacitySlot).toBe('RESERVED');
    expect(mockSessionsExpire).toHaveBeenCalledWith(`cs_${TAG}_stale`);
    expect(res.body.payment.paymentDueAt).toBeTruthy();

    // Corner is now full: a second PAYMENT_DUE application cannot move there.
    const other = await paymentDue(booth.id, `tier3@${TAG}.test`);
    const boothMid = await tierRow(booth.id);
    const full = await changeTier(other, corner.id);
    expect(full.status).toBe(409);
    expect(full.body.message).toMatch(/full/);
    expect((await appRow(other)).tierId).toBe(booth.id);
    expect((await tierRow(booth.id)).quantityReserved).toBe(boothMid.quantityReserved);
    expect((await tierRow(corner.id)).quantityReserved).toBe(1);

    // Clean up the holds so later tests see free capacity.
    for (const appId of [id, other]) expect((await decide(appId, 'WITHDRAW')).status).toBe(200);
    expect((await tierRow(corner.id)).quantityReserved).toBe(0);
  });

  // ─── Adjustments ─────────────────────────────────────────────────────────

  it('adjustments fold into the tier line: discount recomputes, add-on shares hold within a cent, the floor is the tier price, removal restores', async () => {
    const id = await submitted(booth.id, `adj1@${TAG}.test`, [{ addOnId: badge.id, quantity: 2 }]);
    const before = (await detail(id)).body;
    const badgeShare = before.addOns[0].applicantPays;

    expect((await adjust(id, { amount: 0, reason: 'x' })).status).toBe(400);
    expect((await adjust(id, { amount: -25 })).status).toBe(400);
    expect((await adjust(id, { amount: -275.01, reason: 'too deep' })).status).toBe(400);

    sentEmails.length = 0;
    const res = await adjust(id, { amount: -25, reason: 'Returning vendor discount' });
    expect(res.status).toBe(201);
    expect(res.body.adjustments).toHaveLength(1);
    expect(res.body.adjustments[0]).toMatchObject({ kind: 'ADJUSTMENT', amount: -25, reason: 'Returning vendor discount' });
    const expected = await expectedAmounts(booth.id, [{ addOn: await addOnRow(badge.id), quantity: 2 }], -25);
    expect(res.body.amounts.applicantPays).toBeCloseTo(expected.applicantPays, 2);
    expect(res.body.amounts.applicantPays).toBeLessThan(before.amounts.applicantPays);
    expect(Math.abs(res.body.addOns[0].applicantPays - badgeShare)).toBeLessThanOrEqual(0.02); // proportional fee allocation may move a cent
    expect(res.body.decisions.at(-1)).toMatchObject({ action: 'ADJUSTED', note: '−$25.00 Returning vendor discount' });
    expect(sentEmails).toHaveLength(0); // adjustments do not email

    // Floor: tier 275 − 25 already applied → another −250.01 exceeds it, −250 does not.
    expect((await adjust(id, { amount: -250.01, reason: 'over' })).status).toBe(400);
    const second = await adjust(id, { amount: 10, reason: 'Late fee' });
    expect(second.status).toBe(201);
    expect(second.body.adjustments).toHaveLength(2);
    const expectedTwo = await expectedAmounts(booth.id, [{ addOn: await addOnRow(badge.id), quantity: 2 }], -15);
    expect(second.body.amounts.applicantPays).toBeCloseTo(expectedTwo.applicantPays, 2);
    // The price-changed note compares like with like: nothing changed.
    expect(second.body.pricing.changed).toBe(false);

    // Remove the fee → back to the discount only.
    const removed = await request(app).delete(`${adminBase()}/applications/${id}/adjustments/${second.body.adjustments[1].id}`).set(...auth(organizerToken));
    expect(removed.status).toBe(200);
    expect(removed.body.adjustments).toHaveLength(1);
    expect(removed.body.amounts.applicantPays).toBeCloseTo(expected.applicantPays, 2);
    expect(removed.body.decisions.at(-1).note).toBe('Removed +$10.00 Late fee');
    expect((await request(app).delete(`${adminBase()}/applications/${id}/adjustments/nope`).set(...auth(organizerToken))).status).toBe(404);

    // Approve → charge equals the adjusted snapshot; then adjustments are locked.
    const approved = await decide(id, 'APPROVE');
    expect(approved.status).toBe(200);
    expect(approved.body.paymentStatus).toBe('PAID');
    expect(mockIntentsCreate.mock.calls[0][0].amount).toBe(Math.round(expected.applicantPays * 100));
    const lockedRes = await adjust(id, { amount: -5, reason: 'late' });
    expect(lockedRes.status).toBe(409);
    expect(approved.body.amountEditable).toEqual({ allowed: false, reason: 'Already paid — refund part of the amount instead' });
  });

  // ─── Waive ───────────────────────────────────────────────────────────────

  it('ADMIN waives a PAYMENT_DUE balance: zero snapshot, NOT_REQUIRED, slot confirmed, WAIVER row', async () => {
    const id = await paymentDue(booth.id, `waive@${TAG}.test`, [{ addOnId: power.id, quantity: 1 }], 'Waived Co');
    const before = await appRow(id);
    const boothBefore = await tierRow(booth.id);
    const powerBefore = await addOnRow(power.id);
    await prisma.application.update({ where: { id }, data: { stripeCheckoutSessionId: `cs_${TAG}_waive` } });

    expect((await waive(id, { reason: 'Sponsor trade' }, organizerToken)).status).toBe(403);
    expect((await waive(id, {})).status).toBe(400);

    sentEmails.length = 0;
    const res = await waive(id, { reason: 'Sponsor trade' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'APPROVED', paymentStatus: 'NOT_REQUIRED', paymentSource: 'offline', capacitySlot: 'APPROVED' });
    expect(res.body.amounts.applicantPays).toBe(0);
    expect(res.body.amounts.orgReceives).toBe(0);
    expect(res.body.adjustments).toHaveLength(1);
    expect(res.body.adjustments[0]).toMatchObject({ kind: 'WAIVER', amount: -Number(before.applicantPays), reason: 'Sponsor trade' });
    expect(res.body.decisions.at(-1).action).toBe('WAIVED');
    expect(res.body.amountEditable.allowed).toBe(false);
    expect(res.body.payment.canRefund).toBe(false);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].subject).toContain('waived');
    expect(mockSessionsExpire).toHaveBeenCalledWith(`cs_${TAG}_waive`);
    // Slot RESERVED → APPROVED, add-on hold → sold.
    const boothAfter = await tierRow(booth.id);
    expect(boothAfter.quantityReserved).toBe(boothBefore.quantityReserved - 1);
    expect(boothAfter.quantityApproved).toBe(boothBefore.quantityApproved + 1);
    const powerAfter = await addOnRow(power.id);
    expect(powerAfter.quantityReserved).toBe(powerBefore.quantityReserved - 1);
    expect(powerAfter.quantitySold).toBe(powerBefore.quantitySold + 1);
    // A waiver cannot be undone through the adjustments route.
    expect((await request(app).delete(`${adminBase()}/applications/${id}/adjustments/${res.body.adjustments[0].id}`).set(...auth(adminToken))).status).toBe(409);
  });

  // ─── Offline payment + manual refund ─────────────────────────────────────

  it('ADMIN records an offline payment: PAID / OFFLINE with no Stripe object, slot confirmed; manual refund records without Stripe', async () => {
    const id = await paymentDue(booth.id, `cheque@${TAG}.test`, [{ addOnId: badge.id, quantity: 1 }], 'Cheque Co');
    const before = await appRow(id);
    const due = Number(before.applicantPays);
    const boothBefore = await tierRow(booth.id);
    const badgeBefore = await addOnRow(badge.id);
    const declinedIntent = before.stripePaymentIntentId;
    resetStripeMocks(); // the declined approval attempt above is not what this test measures

    expect((await offline(id, { method: 'CHEQUE', amount: due }, organizerToken)).status).toBe(403);
    expect((await offline(id, { method: 'PAYPAL', amount: due })).status).toBe(400);
    const mismatch = await offline(id, { method: 'CHEQUE', amount: due - 1 });
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.message).toMatch(/must equal the balance due/);
    expect((await offline(id, { method: 'CHEQUE', amount: due, paidAt: '2099-01-01T00:00:00Z' })).status).toBe(400);

    sentEmails.length = 0;
    const res = await offline(id, { method: 'CHEQUE', amount: due, reference: '#1042', paidAt: '2026-09-16T14:00:00Z' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'APPROVED', paymentStatus: 'PAID', paymentSource: 'offline', capacitySlot: 'APPROVED' });
    expect(res.body.offlinePayment).toMatchObject({ method: 'CHEQUE', reference: '#1042' });
    expect(res.body.offlinePayment.recordedById).toBeTruthy();
    expect(res.body.payment.paidAt).toBe('2026-09-16T14:00:00.000Z');
    expect(res.body.payment.paymentDueAt).toBeNull();
    expect(res.body.payment).toMatchObject({ canRefund: true, manualRefund: true, canRetryCharge: false });
    expect(res.body.decisions.at(-1)).toMatchObject({ action: 'OFFLINE_PAID', note: `Cheque #1042, $${due.toFixed(2)}` });
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].subject).toContain('Payment received');
    // The declined intent id from the approval attempt stays as history; no new Stripe object.
    const row = await appRow(id);
    expect(row.stripePaymentIntentId).toBe(declinedIntent);
    expect(mockIntentsCreate).not.toHaveBeenCalled();
    expect(mockSessionsCreate).not.toHaveBeenCalled();
    const boothAfter = await tierRow(booth.id);
    expect(boothAfter.quantityReserved).toBe(boothBefore.quantityReserved - 1);
    expect(boothAfter.quantityApproved).toBe(boothBefore.quantityApproved + 1);
    expect((await addOnRow(badge.id)).quantitySold).toBe(badgeBefore.quantitySold + 1);

    // Wrong state now (PAID): 409. Tier / adjustments are locked as "settled outside Stripe".
    expect((await offline(id, { method: 'CASH', amount: due })).status).toBe(409);
    expect((await changeTier(id, corner.id)).status).toBe(409);
    expect(res.body.amountEditable.reason).toMatch(/Settled outside Stripe/);

    // Manual refund: ledger row with manual = true, no Stripe call, status PARTIALLY_REFUNDED, MANUAL_REFUND logged.
    const refund = await request(app).post(`${adminBase()}/applications/${id}/refund`).set(...auth(adminToken)).send({ amount: 20, reason: 'Left early' });
    expect(refund.status).toBe(200);
    expect(mockRefundsCreate).not.toHaveBeenCalled();
    expect(refund.body.paymentStatus).toBe('PARTIALLY_REFUNDED');
    expect(refund.body.refunds).toHaveLength(1);
    expect(refund.body.refunds[0]).toMatchObject({ amount: 20, status: 'SUCCEEDED', manual: true, stripeRefundId: null, reason: 'Left early' });
    expect(refund.body.decisions.at(-1)).toMatchObject({ action: 'MANUAL_REFUND', note: 'Recorded refund of $20.00: Left early' });

    // Customers and analytics count it like a Stripe payment.
    const customers = await request(app).get(`/admin/customers?search=${encodeURIComponent(`cheque@${TAG}.test`)}`).set(...auth(adminToken));
    expect(customers.body.data).toHaveLength(1);
    expect(customers.body.data[0]).toMatchObject({ applicationCount: 1, totalSpent: due, totalRefunded: 20 });
  });

  it('organizers may change tier and adjust but not waive or settle; UNASSIGNED sees nothing', async () => {
    const id = await submitted(booth.id, `roles@${TAG}.test`);
    expect((await adjust(id, { amount: -5, reason: 'ok' }, organizerToken)).status).toBe(201);
    expect((await waive(id, { reason: 'x' }, organizerToken)).status).toBe(403);
    expect((await offline(id, { method: 'CASH', amount: 1 }, organizerToken)).status).toBe(403);
    // SUBMITTED (not PAYMENT_DUE) cannot be settled offline even by ADMIN.
    expect((await waive(id, { reason: 'x' })).status).toBe(409);
    expect((await offline(id, { method: 'CASH', amount: 1 })).status).toBe(409);
    const nobody = await staffToken({ email: `nobody@${TAG}.test`, role: 'UNASSIGNED' });
    expect((await adjust(id, { amount: -5, reason: 'ok' }, nobody)).status).toBe(403);
    await cleanupStaff([`nobody@${TAG}.test`]);
  });
});
