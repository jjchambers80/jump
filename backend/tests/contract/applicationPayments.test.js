// Contract tests for Applications phase 2 — the payment engine (spec 011)
// Card on file at submission (setup-mode Checkout) → off-session charge at
// approval (PAID / PAYMENT_DUE) → pay-now → refunds; pay-at-submission forms;
// Connect destination routing of the application charge; concurrent
// approvals on a 1-slot tier; webhook dispatch and idempotency; overdue sweep.
// Stripe and Resend mocked; Postgres is real.

import fs from 'node:fs';
import { jest } from '@jest/globals';
import request from 'supertest';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';
import { allAcceptances } from '../helpers/legal.js';

const sentEmails = [];
jest.unstable_mockModule('../../src/config/resend.js', () => ({
  default: { emails: { send: jest.fn(async (msg) => { sentEmails.push(msg); return { id: 'mock' }; }) } },
}));

const mockSessionsCreate = jest.fn();
const mockCustomersCreate = jest.fn();
const mockIntentsCreate = jest.fn();
const mockIntentsRetrieve = jest.fn();
const mockSetupIntentsRetrieve = jest.fn();
const mockRefundsCreate = jest.fn();
const mockRefundsList = jest.fn();
const mockChargesRetrieve = jest.fn();

jest.unstable_mockModule('../../src/config/stripe.js', () => ({
  default: {
    checkout: { sessions: { create: mockSessionsCreate, retrieve: jest.fn() } },
    customers: { create: mockCustomersCreate },
    paymentIntents: { create: mockIntentsCreate, retrieve: mockIntentsRetrieve },
    setupIntents: { retrieve: mockSetupIntentsRetrieve },
    refunds: { create: mockRefundsCreate, list: mockRefundsList },
    charges: { retrieve: mockChargesRetrieve },
    webhooks: { constructEvent: jest.fn() },
  },
}));

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');
const { default: paymentSettingsService } = await import('../../src/services/PaymentSettingsService.js');
const { default: applicationPaymentService } = await import('../../src/services/ApplicationPaymentService.js');
const { statusToken } = await import('../../src/services/applicationLinks.js');
const {
  appRow: loadRow,
  setDueAt,
  cleanupApplicationOrders,
} = await import('../helpers/applicationRow.js');

const TAG = 'apppay-ct';
const ACCT = 'acct_apppay_ct';

paymentSettingsService._statusCache = {
  value: {
    provider: 'STRIPE',
    mode: 'test',
    charges: 'active',
    statementDescriptorPrefix: 'JUMP',
    capabilities: { link: 'active', cashapp: null, affirm: null, klarna: null, afterpay_clearpay: null },
    manageUrl: 'https://dashboard.stripe.com/test/',
    radarUrl: 'https://dashboard.stripe.com/test/radar/rules',
    error: null,
  },
  expiresAt: Number.POSITIVE_INFINITY,
};

let sessionN = 0;
let customerN = 0;
let intentN = 0;
let refundN = 0;

function resetStripeMocks() {
  mockSessionsCreate.mockReset().mockImplementation(async (params) => {
    sessionN += 1;
    return { id: `cs_${TAG}_${sessionN}`, url: `https://checkout.stripe.com/c/pay/cs_${TAG}_${sessionN}`, mode: params.mode, metadata: params.metadata };
  });
  mockCustomersCreate.mockReset().mockImplementation(async () => {
    customerN += 1;
    return { id: `cus_${TAG}_${customerN}` };
  });
  mockIntentsCreate.mockReset().mockImplementation(async () => {
    intentN += 1;
    return { id: `pi_${TAG}_${intentN}`, status: 'succeeded' };
  });
  mockIntentsRetrieve.mockReset().mockResolvedValue({ transfer_data: null, application_fee_amount: null });
  mockSetupIntentsRetrieve.mockReset().mockImplementation(async (id) => ({ id, payment_method: `pm_${TAG}_${id}` }));
  mockRefundsCreate.mockReset().mockImplementation(async (params) => {
    refundN += 1;
    return { id: `re_${TAG}_${refundN}`, amount: params.amount, status: 'succeeded' };
  });
  mockRefundsList.mockReset().mockResolvedValue({ data: [] });
  mockChargesRetrieve.mockReset().mockResolvedValue(null);
}

// Real Stripe payloads, recorded from the test-mode account. The charge in a
// charge.refunded event has NO `refunds` key — a hand-built fixture that
// invents one passes against a dead code path, which is exactly how refunds
// issued from the Stripe dashboard went unnoticed. Build events from these.
const RECORDED = JSON.parse(
  fs.readFileSync(new URL('../fixtures/stripeRefundEvents.json', import.meta.url), 'utf8')
);

let eventN = 0;

/** charge.refunded exactly as Stripe sends it, with this test's ids. */
function chargeRefundedEvent({ chargeId, paymentIntentId, amountRefunded }) {
  return {
    id: `evt_${TAG}_cr_${(eventN += 1)}`,
    type: 'charge.refunded',
    api_version: RECORDED.chargeRefunded.api_version,
    data: {
      object: {
        ...RECORDED.chargeRefunded.data.object,
        id: chargeId,
        payment_intent: paymentIntentId,
        amount_refunded: amountRefunded,
      },
    },
  };
}

/** A refund object in the shape refunds.list and the refund.* events carry. */
const refundObject = (overrides) => ({ ...RECORDED.refundCreated.data.object, ...overrides });

/** refund.created / refund.updated / charge.refund.updated, as Stripe sends them. */
function refundEvent(type, overrides) {
  return {
    id: `evt_${TAG}_re_${(eventN += 1)}`,
    type,
    api_version: RECORDED.refundCreated.api_version,
    data: { object: refundObject(overrides) },
  };
}

function cardDecline(code = 'card_declined') {
  const err = new Error('Your card was declined.');
  err.type = 'StripeCardError';
  err.code = code;
  err.raw = { payment_intent: { id: `pi_${TAG}_declined_${++intentN}` } };
  return err;
}

async function webhook(event) {
  return request(app).post('/webhooks/stripe').set('Content-Type', 'application/json').send(JSON.stringify(event));
}

const checkoutCompleted = (session) => ({ id: `evt_${Math.random()}`, type: 'checkout.session.completed', data: { object: session } });

describe('Application payments contract (spec 011 phase 2)', () => {
  let adminToken;
  let organizerToken;
  let adminUserId;
  let org;
  let eventId;
  let approvalForm;
  let submitForm;
  const emails = [`admin@${TAG}.test`, `organizer@${TAG}.test`];
  const auth = (token) => ['Authorization', `Bearer ${token}`];
  const adminBase = () => `/admin/events/${eventId}`;

  const submit = (formSlug, tierId, email, businessName = 'Hidden Block Games') =>
    request(app)
      .post(`/events/${eventId}/applications`)
      .send({ formSlug, tierId, contact: { email, firstName: 'Vee', lastName: 'Vendor' }, acceptances: allAcceptances(), profile: { businessName }, answers: {} });

  const appRow = (id) => loadRow(id, { tier: true, contact: true });

  /** Drive a DRAFT card-on-file application to SUBMITTED via the setup webhook. */
  async function cardOnFile(applicationId) {
    const row = await appRow(applicationId);
    const res = await webhook(
      checkoutCompleted({ id: row.stripeCheckoutSessionId, mode: 'setup', setup_intent: `seti_${applicationId}`, customer: row.contact.stripeCustomerId, metadata: { applicationId, purpose: 'submit' } })
    );
    expect(res.status).toBe(200);
    return appRow(applicationId);
  }

  beforeAll(async () => {
    process.env.APPLICATIONS_PAYMENTS_ENABLED = 'true';
    await prisma.organization.deleteMany({ where: { name: { startsWith: `${TAG} ` } } }).catch(() => {});
    adminToken = await staffToken({ email: emails[0], role: 'ADMIN' });
    organizerToken = await staffToken({ email: emails[1], role: 'ORGANIZER' });
    adminUserId = (await prisma.user.findUnique({ where: { email: emails[0] } })).id;
    org = await prisma.organization.create({ data: { name: `${TAG} Gaming Geek`, email: `owner@${TAG}.test`, statementDescriptorSuffix: 'GEEK EXPO' } });
    await joinOrgByToken(adminToken, org.id, 'ADMIN');
    await joinOrgByToken(organizerToken, org.id, 'ORGANIZER');
    const venue = await prisma.venue.create({ data: { organizationId: org.id, name: `${TAG} RCC`, address: '500 S Salisbury St', city: 'Raleigh', state: 'NC' } });
    const event = await prisma.event.create({
      data: { venueId: venue.id, name: `${TAG} Expo 2027`, date: new Date('2027-09-18T15:00:00Z'), status: 'PUBLISHED', capacity: 1000, taxRate: 0.0725 },
    });
    eventId = event.id;

    const a = await request(app)
      .post(`${adminBase()}/application-forms`)
      .set(...auth(adminToken))
      .send({
        kind: 'PAID',
        name: 'Vendor Space',
        chargeTiming: 'APPROVAL',
        paymentDueDays: 5,
        tiers: [
          { name: '10x10', price: 275, quantityTotal: 20 },
          { name: 'Single slot', price: 100, quantityTotal: 1 },
        ],
      });
    expect(a.status).toBe(201);
    approvalForm = a.body;
    const s = await request(app)
      .post(`${adminBase()}/application-forms`)
      .set(...auth(adminToken))
      .send({ kind: 'PAID', name: 'Sponsors', chargeTiming: 'SUBMIT', feeMode: 'ABSORB', tiers: [{ name: 'Gold', price: 1000, quantityTotal: 2 }] });
    expect(s.status).toBe(201);
    submitForm = s.body;
  });

  afterAll(async () => {
    delete process.env.APPLICATIONS_PAYMENTS_ENABLED;
    delete process.env.STRIPE_CONNECT_ENABLED;
    await cleanupApplicationOrders(org.id);
    await prisma.application.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.applicantProfile.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.applicationForm.deleteMany({ where: { eventId } }).catch(() => {});
    await prisma.contact.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.event.deleteMany({ where: { id: eventId } }).catch(() => {});
    await prisma.venue.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.organization.deleteMany({ where: { id: org.id } }).catch(() => {});
    await cleanupStaff(emails);
    paymentSettingsService._invalidate();
  });

  beforeEach(() => {
    sentEmails.length = 0;
    resetStripeMocks();
    delete process.env.STRIPE_CONNECT_ENABLED;
  });

  // ─── Opening + submission ────────────────────────────────────────────────

  it('a PAID form opens with the flag on and exposes paymentsEnabled', async () => {
    for (const form of [approvalForm, submitForm]) {
      const res = await request(app).patch(`${adminBase()}/application-forms/${form.id}`).set(...auth(adminToken)).send({ status: 'OPEN' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'OPEN', paymentsEnabled: true, acceptance: { open: true } });
    }
  });

  let cardApp; // APPROVAL timing, will be charged successfully

  it('card-on-file submission: DRAFT + setup-mode Checkout with the applicant as a Stripe customer', async () => {
    const tier = approvalForm.tiers.find((t) => t.name === '10x10');
    const res = await submit('vendor-space', tier.id, `vendor1@${TAG}.test`);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ next: 'checkout' });
    expect(res.body.checkoutUrl).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    cardApp = res.body.applicationId;

    const params = mockSessionsCreate.mock.calls[0][0];
    expect(params).toMatchObject({ mode: 'setup', payment_method_types: ['card'], customer: `cus_${TAG}_1`, metadata: { applicationId: cardApp, purpose: 'submit' } });
    expect(params.setup_intent_data.metadata.applicationId).toBe(cardApp);
    expect(params.success_url).toMatch(new RegExp(`/apply/status/${cardApp}\\?token=[a-f0-9]{64}&checkout=submitted$`));
    expect(mockCustomersCreate).toHaveBeenCalledTimes(1);
    expect(mockCustomersCreate.mock.calls[0][0]).toMatchObject({ email: `vendor1@${TAG}.test`, name: 'Vee Vendor' });

    const row = await appRow(cardApp);
    expect(row).toMatchObject({ status: 'DRAFT', paymentStatus: 'AWAITING_CARD', capacitySlot: 'NONE', stripeCheckoutSessionId: `cs_${TAG}_1` });
    expect(Number(row.applicantPays)).toBeGreaterThan(275);
    expect(Number(row.orgReceives)).toBe(275);
    expect(row.contact.stripeCustomerId).toBe(`cus_${TAG}_1`);
    expect(sentEmails).toHaveLength(0); // RECEIVED only once the card is saved

    // Not visible to the organizer yet
    const list = await request(app).get(`${adminBase()}/applications`).set(...auth(organizerToken));
    expect(list.body.data.map((a) => a.id)).not.toContain(cardApp);
  });

  it('guest status page shows canResume and /resume mints a new session; resubmitting replaces the DRAFT', async () => {
    const token = statusToken(cardApp);
    const status = await request(app).get(`/applications/${cardApp}/status?token=${token}`);
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ status: 'DRAFT', canResume: true, canPay: false, canWithdraw: false });

    const resume = await request(app).post(`/applications/${cardApp}/resume?token=${token}`);
    expect(resume.status).toBe(200);
    expect(resume.body.url).toContain(`cs_${TAG}_2`);
    expect(mockCustomersCreate).not.toHaveBeenCalled(); // customer reused

    const bad = await request(app).post(`/applications/${cardApp}/resume?token=nope`);
    expect(bad.status).toBe(404);

    const tier = approvalForm.tiers.find((t) => t.name === '10x10');
    const again = await submit('vendor-space', tier.id, `vendor1@${TAG}.test`);
    expect(again.status).toBe(201);
    expect(again.body.applicationId).not.toBe(cardApp);
    // Spec 024: the replaced DRAFT is withdrawn, never deleted; its order is CANCELLED.
    const replaced = await appRow(cardApp);
    expect(replaced).toMatchObject({
      status: 'WITHDRAWN',
      withdrawnBy: 'SYSTEM',
      withdrawReason: 'replaced',
      orderStatus: 'CANCELLED',
    });
    expect(again.body.orderRef).toMatch(/^JMP-[A-Z2-9]{6}$/);
    expect((await appRow(again.body.applicationId)).orderStatus).toBe('PENDING');
    cardApp = again.body.applicationId;
  });

  it('checkout.session.completed (setup) stores the card, submits the application and sends RECEIVED', async () => {
    const row = await cardOnFile(cardApp);
    expect(row).toMatchObject({ status: 'SUBMITTED', paymentStatus: 'CARD_ON_FILE', stripePaymentMethodId: `pm_${TAG}_seti_${cardApp}` });
    expect(row.submittedAt).toBeTruthy();
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].subject).toMatch(/received your application/);
    expect(sentEmails[0].text).toContain(`/apply/status/${cardApp}?token=${statusToken(cardApp)}`);

    // Replay is a no-op
    await cardOnFile(cardApp);
    expect(sentEmails).toHaveLength(1);

    const status = await request(app).get(`/applications/${cardApp}/status?token=${statusToken(cardApp)}`);
    expect(status.body).toMatchObject({ status: 'SUBMITTED', paymentStatus: 'CARD_ON_FILE', canWithdraw: true, canUpdateCard: true, canResume: false });
  });

  // ─── Approval → charge ───────────────────────────────────────────────────

  it('approve charges the saved card off-session (platform account, descriptor suffix) and confirms the slot', async () => {
    const res = await request(app).post(`${adminBase()}/applications/${cardApp}/decision`).set(...auth(organizerToken)).send({ decision: 'APPROVE' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'APPROVED', paymentStatus: 'PAID', capacitySlot: 'APPROVED' });
    expect(res.body.payment).toMatchObject({ stripePaymentIntentId: `pi_${TAG}_1`, stripeAccountId: null, applicationFee: null, chargeAttempts: 1, canRefund: true, canRetryCharge: false });
    expect(res.body.payment.paidAt).toBeTruthy();
    expect(res.body.payment.stripeDashboardUrl).toBe(`https://dashboard.stripe.com/test/payments/pi_${TAG}_1`);

    const [params, options] = mockIntentsCreate.mock.calls[0];
    const row = await appRow(cardApp);
    expect(params).toMatchObject({
      amount: Math.round(Number(row.applicantPays) * 100),
      currency: 'usd',
      customer: row.contact.stripeCustomerId,
      payment_method: row.stripePaymentMethodId,
      off_session: true,
      confirm: true,
      payment_method_types: ['card'],
      statement_descriptor_suffix: 'GEEK EXPO',
      metadata: { applicationId: cardApp, purpose: 'approval' },
    });
    expect(params.transfer_data).toBeUndefined();
    expect(params.application_fee_amount).toBeUndefined();
    expect(options).toEqual({ idempotencyKey: `application:${cardApp}:charge:1` });

    const tier = await prisma.applicationTier.findUnique({ where: { id: row.tierId } });
    expect(tier).toMatchObject({ quantityApproved: 1, quantityReserved: 0 });
    // Spec 024 phase 2: Jump's receipt precedes the organizer's approval email.
    expect(sentEmails.map((e) => e.subject)).toEqual([expect.stringMatching(/^Receipt for .* \(JMP-[A-Z2-9]{6}\)$/), expect.stringMatching(/approved/)]);
    expect(sentEmails[0].text).toContain(`Order number: ${res.body.orderRef}`);
    expect(sentEmails[0].text).toContain(`Total paid: $${res.body.amounts.applicantPays.toFixed(2)}`);
    const decision = res.body.decisions.find((d) => d.action === 'APPROVED');
    expect(decision.emailSubject).toMatch(/approved/);

    // payment_intent.succeeded after the fact is idempotent (no second email)
    const hook = await webhook({ id: 'evt_pi_ok', type: 'payment_intent.succeeded', data: { object: { id: `pi_${TAG}_1`, status: 'succeeded', metadata: { applicationId: cardApp, purpose: 'approval' } } } });
    expect(hook.status).toBe(200);
    expect(sentEmails).toHaveLength(2); // receipt + approval from before; nothing new
    expect((await appRow(cardApp)).paymentStatus).toBe('PAID');
  });

  it('approving a map-bound tier reserves capacity but waits for booth selection before charging', async () => {
    const tier = await prisma.applicationTier.create({
      data: { formId: approvalForm.id, name: 'Map booth', price: 325, quantityTotal: 2, mapBound: true, displayOrder: 99 },
    });
    const created = await submit('vendor-space', tier.id, `map-vendor@${TAG}.test`, 'Map Vendor');
    const applicationId = created.body.applicationId;
    await cardOnFile(applicationId);
    const chargesBefore = mockIntentsCreate.mock.calls.length;

    const response = await request(app)
      .post(`${adminBase()}/applications/${applicationId}/decision`)
      .set(...auth(organizerToken))
      .send({ decision: 'APPROVE' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'APPROVED', paymentStatus: 'PAYMENT_DUE', capacitySlot: 'RESERVED' });
    expect(response.body.payment.paymentDueAt).toBeTruthy();
    expect(mockIntentsCreate).toHaveBeenCalledTimes(chargesBefore);
    expect(await prisma.applicationTier.findUnique({ where: { id: tier.id } })).toMatchObject({ quantityApproved: 0, quantityReserved: 1 });
  });

  let dueApp; // APPROVAL timing, declined card → PAYMENT_DUE → pay-now

  it('a declined card leaves the application APPROVED + PAYMENT_DUE with the slot reserved and a PAYMENT_DUE email', async () => {
    const tier = approvalForm.tiers.find((t) => t.name === '10x10');
    const created = await submit('vendor-space', tier.id, `vendor2@${TAG}.test`, 'Pixel Pins');
    dueApp = created.body.applicationId;
    await cardOnFile(dueApp);
    sentEmails.length = 0;
    mockIntentsCreate.mockRejectedValueOnce(cardDecline());

    const res = await request(app).post(`${adminBase()}/applications/${dueApp}/decision`).set(...auth(organizerToken)).send({ decision: 'APPROVE', message: { subject: 'Custom approve', body: 'ignored on decline' } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'APPROVED', paymentStatus: 'PAYMENT_DUE', capacitySlot: 'RESERVED' });
    expect(res.body.payment.canRetryCharge).toBe(true);
    const dueAt = new Date(res.body.payment.paymentDueAt);
    const days = (dueAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(4.9);
    expect(days).toBeLessThan(5.1);

    const tierRow = await prisma.applicationTier.findUnique({ where: { id: tier.id } });
    expect(tierRow).toMatchObject({ quantityApproved: 1, quantityReserved: 1 });
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].subject).toMatch(/Payment needed/);
    expect(sentEmails[0].text).toContain(`/apply/status/${dueApp}?token=`);
    // The one-off organizer message applies to the APPROVED email only; the due email is the template.
    expect(sentEmails[0].subject).not.toBe('Custom approve');
  });

  it('pay-now mints a payment-mode session for the snapshot amount; the paid webhook confirms the slot', async () => {
    const token = statusToken(dueApp);
    const status = await request(app).get(`/applications/${dueApp}/status?token=${token}`);
    expect(status.body).toMatchObject({ status: 'APPROVED', paymentStatus: 'PAYMENT_DUE', canPay: true, canUpdateCard: true, canWithdraw: false });

    const pay = await request(app).post(`/applications/${dueApp}/pay?token=${token}`);
    expect(pay.status).toBe(200);
    expect(pay.body.url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    const params = mockSessionsCreate.mock.calls.at(-1)[0];
    const row = await appRow(dueApp);
    expect(params).toMatchObject({ mode: 'payment', customer: row.contact.stripeCustomerId, metadata: { applicationId: dueApp, purpose: 'pay_now' } });
    expect(params.line_items).toHaveLength(1);
    expect(params.line_items[0]).toMatchObject({ quantity: 1, price_data: { unit_amount: Math.round(Number(row.applicantPays) * 100) } });
    expect(params.payment_intent_data).toMatchObject({ statement_descriptor_suffix: 'GEEK EXPO', metadata: { applicationId: dueApp, purpose: 'pay_now' } });
    expect(params.success_url).toMatch(/checkout=paid$/);

    sentEmails.length = 0;
    const hook = await webhook(checkoutCompleted({ id: params.metadata && row.stripeCheckoutSessionId, mode: 'payment', payment_status: 'paid', payment_intent: `pi_${TAG}_paynow`, metadata: { applicationId: dueApp, purpose: 'pay_now' } }));
    expect(hook.status).toBe(200);
    const after = await appRow(dueApp);
    expect(after).toMatchObject({ status: 'APPROVED', paymentStatus: 'PAID', capacitySlot: 'APPROVED', stripePaymentIntentId: `pi_${TAG}_paynow`, paymentDueAt: null, overdue: false });
    const tierRow = await prisma.applicationTier.findUnique({ where: { id: after.tierId } });
    expect(tierRow).toMatchObject({ quantityApproved: 2, quantityReserved: 0 });
    expect(sentEmails.map((e) => e.subject)).toEqual([expect.stringMatching(/^Receipt for/), expect.stringMatching(/approved/)]);

    // Pay again → 409, nothing due
    const again = await request(app).post(`/applications/${dueApp}/pay?token=${token}`);
    expect(again.status).toBe(409);
  });

  it('retry charge: organizer re-runs the saved card after a decline; a Stripe outage keeps the card on file', async () => {
    const tier = approvalForm.tiers.find((t) => t.name === '10x10');
    const created = await submit('vendor-space', tier.id, `vendor3@${TAG}.test`, 'Retry Co');
    const id = created.body.applicationId;
    await cardOnFile(id);
    mockIntentsCreate.mockRejectedValueOnce(cardDecline('authentication_required'));
    const declined = await request(app).post(`${adminBase()}/applications/${id}/decision`).set(...auth(organizerToken)).send({ decision: 'APPROVE' });
    expect(declined.body).toMatchObject({ status: 'APPROVED', paymentStatus: 'PAYMENT_DUE' });

    const retry = await request(app).post(`${adminBase()}/applications/${id}/charge`).set(...auth(organizerToken));
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({ status: 'APPROVED', paymentStatus: 'PAID', capacitySlot: 'APPROVED' });
    expect(retry.body.payment.chargeAttempts).toBe(2);
    expect(mockIntentsCreate.mock.calls.at(-1)[1]).toEqual({ idempotencyKey: `application:${id}:charge:2` });

    const twice = await request(app).post(`${adminBase()}/applications/${id}/charge`).set(...auth(organizerToken));
    expect(twice.status).toBe(409);

    // Outage path: not a card error → 400 to the organizer, application back to SUBMITTED-equivalent money state
    const created2 = await submit('vendor-space', tier.id, `vendor4@${TAG}.test`, 'Outage Co');
    const id2 = created2.body.applicationId;
    await cardOnFile(id2);
    mockIntentsCreate.mockRejectedValueOnce(new Error('connection reset'));
    const outage = await request(app).post(`${adminBase()}/applications/${id2}/decision`).set(...auth(organizerToken)).send({ decision: 'APPROVE' });
    expect(outage.status).toBe(400);
    expect(outage.body.message).toMatch(/Could not charge the card on file/);
    const row = await appRow(id2);
    // PAYMENT_DUE is the one state retry charge, pay-now and offline settlement
    // all accept; the saved card stays on the row for the retry.
    expect(row).toMatchObject({ status: 'APPROVED', paymentStatus: 'PAYMENT_DUE', capacitySlot: 'RESERVED' });
    expect(row.stripePaymentMethodId).toBeTruthy();
    // Clean up the reserved slot for later tests
    await prisma.$transaction([
      prisma.application.update({ where: { id: id2 }, data: { status: 'WITHDRAWN', capacitySlot: 'NONE' } }),
      prisma.applicationTier.update({ where: { id: tier.id }, data: { quantityReserved: { decrement: 1 } } }),
    ]);
  });

  it('concurrent approvals on a 1-slot tier: one PAID, one 409 with a Waitlist suggestion, no charge for the loser', async () => {
    const tier = approvalForm.tiers.find((t) => t.name === 'Single slot');
    const ids = [];
    for (const n of [1, 2]) {
      const created = await submit('vendor-space', tier.id, `single${n}@${TAG}.test`, `Single ${n}`);
      ids.push(created.body.applicationId);
      await cardOnFile(created.body.applicationId);
    }
    mockIntentsCreate.mockClear();
    const results = await Promise.all(ids.map((id) => request(app).post(`${adminBase()}/applications/${id}/decision`).set(...auth(organizerToken)).send({ decision: 'APPROVE' })));
    const codes = results.map((r) => r.status).sort();
    expect(codes).toEqual([200, 409]);
    const loser = results.find((r) => r.status === 409);
    expect(loser.body.message).toMatch(/tier is full/);
    expect(loser.body.details.suggestion).toBe('WAITLIST');
    expect(mockIntentsCreate).toHaveBeenCalledTimes(1);
    const tierRow = await prisma.applicationTier.findUnique({ where: { id: tier.id } });
    expect(tierRow).toMatchObject({ quantityApproved: 1, quantityReserved: 0 });
  });

  // ─── Pay at submission ───────────────────────────────────────────────────

  let sponsorApp;

  it('SUBMIT timing: payment-mode Checkout at submission; paid webhook submits; approve takes the slot without a charge', async () => {
    const tier = submitForm.tiers[0];
    const created = await submit('sponsors', tier.id, `sponsor@${TAG}.test`, 'MegaCorp');
    expect(created.status).toBe(201);
    sponsorApp = created.body.applicationId;
    const params = mockSessionsCreate.mock.calls[0][0];
    const row = await appRow(sponsorApp);
    // ABSORB: the sponsor pays the listed price; fees come out of the org's share
    expect(Number(row.applicantPays)).toBe(1000);
    expect(Number(row.orgReceives)).toBeLessThan(1000);
    expect(params).toMatchObject({ mode: 'payment', metadata: { applicationId: sponsorApp, purpose: 'submit' } });
    expect(params.line_items[0].price_data.unit_amount).toBe(100000);
    expect(row).toMatchObject({ status: 'DRAFT', paymentStatus: 'NOT_REQUIRED' });

    const hook = await webhook(checkoutCompleted({ id: row.stripeCheckoutSessionId, mode: 'payment', payment_status: 'paid', payment_intent: `pi_${TAG}_sponsor`, metadata: { applicationId: sponsorApp, purpose: 'submit' } }));
    expect(hook.status).toBe(200);
    const paid = await appRow(sponsorApp);
    expect(paid).toMatchObject({ status: 'SUBMITTED', paymentStatus: 'PAID', capacitySlot: 'NONE', stripePaymentIntentId: `pi_${TAG}_sponsor` });
    expect(paid.submittedAt).toBeTruthy();
    expect(sentEmails.map((e) => e.subject)).toEqual([expect.stringMatching(/^Receipt for/), expect.stringMatching(/received your application/)]);

    mockIntentsCreate.mockClear();
    const res = await request(app).post(`${adminBase()}/applications/${sponsorApp}/decision`).set(...auth(organizerToken)).send({ decision: 'APPROVE' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'APPROVED', paymentStatus: 'PAID', capacitySlot: 'APPROVED' });
    expect(mockIntentsCreate).not.toHaveBeenCalled();
    const tierRow = await prisma.applicationTier.findUnique({ where: { id: tier.id } });
    expect(tierRow).toMatchObject({ quantityApproved: 1, quantityReserved: 0 });
  });

  // ─── Refunds ─────────────────────────────────────────────────────────────

  it('refunds: ADMIN only; partial then full; Stripe flags; charge.refunded webhook is idempotent', async () => {
    const forbidden = await request(app).post(`${adminBase()}/applications/${sponsorApp}/refund`).set(...auth(organizerToken)).send({ amount: 100 });
    expect(forbidden.status).toBe(403);

    const bad = await request(app).post(`${adminBase()}/applications/${sponsorApp}/refund`).set(...auth(adminToken)).send({ amount: 5000 });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toMatch(/cannot exceed/);

    const partial = await request(app).post(`${adminBase()}/applications/${sponsorApp}/refund`).set(...auth(adminToken)).send({ amount: 250, reason: 'Smaller booth' });
    expect(partial.status).toBe(200);
    expect(partial.body).toMatchObject({ status: 'APPROVED', paymentStatus: 'PARTIALLY_REFUNDED' });
    expect(partial.body.payment).toMatchObject({ refundedTotal: 250, refundable: 750, canRefund: true });
    expect(partial.body.refunds).toHaveLength(1);
    expect(partial.body.refunds[0]).toMatchObject({ amount: 250, status: 'SUCCEEDED', reason: 'Smaller booth', initiatedBy: adminUserId });
    expect(mockRefundsCreate.mock.calls[0][0]).toMatchObject({ payment_intent: `pi_${TAG}_sponsor`, amount: 25000, reason: 'requested_by_customer', metadata: { applicationId: sponsorApp } });
    expect(mockRefundsCreate.mock.calls[0][0].reverse_transfer).toBeUndefined();
    // Every create-charge/refund call carries an idempotency key, so a retry
    // after a lost response resolves to the same Stripe refund (see below).
    expect(mockRefundsCreate.mock.calls[0][1]).toMatchObject({ idempotencyKey: expect.any(String) });

    // Dashboard refund arrives by webhook, in the shape Stripe really sends:
    // the charge carries no `refunds`, so the handler reads them off the API.
    mockRefundsList.mockResolvedValue({
      data: [
        refundObject({ id: `re_${TAG}_1`, payment_intent: `pi_${TAG}_sponsor`, amount: 25000, reason: null, status: 'succeeded' }),
        refundObject({ id: 're_external', payment_intent: `pi_${TAG}_sponsor`, amount: 10000, reason: 'duplicate', status: 'succeeded' }),
      ],
    });
    const event = chargeRefundedEvent({ chargeId: 'ch_1', paymentIntentId: `pi_${TAG}_sponsor`, amountRefunded: 35000 });
    expect('refunds' in event.data.object).toBe(false); // the whole point of the recorded fixture
    const hook = await webhook(event);
    expect(hook.status).toBe(200);
    expect(mockRefundsList).toHaveBeenCalledWith({ charge: 'ch_1', limit: 100 }, undefined);
    let row = await appRow(sponsorApp);
    // re_..._1 is the admin refund above, already recorded; re_external is new
    expect(row.refunds).toHaveLength(2);
    expect(row.refunds.map((r) => r.stripeRefundId).sort()).toEqual([`re_${TAG}_1`, 're_external']);
    expect(row.paymentStatus).toBe('PARTIALLY_REFUNDED');

    // Redelivery of the same event changes nothing (Stripe retries; so does a replay).
    expect((await webhook(event)).status).toBe(200);
    row = await appRow(sponsorApp);
    expect(row.refunds).toHaveLength(2);

    const full = await request(app).post(`${adminBase()}/applications/${sponsorApp}/refund`).set(...auth(adminToken)).send({});
    expect(full.status).toBe(200);
    expect(full.body).toMatchObject({ paymentStatus: 'REFUNDED' });
    expect(full.body.payment).toMatchObject({ refundedTotal: 1000, refundable: 0, canRefund: false });
    expect(mockRefundsCreate.mock.calls.at(-1)[0].amount).toBe(65000);

    const nothingLeft = await request(app).post(`${adminBase()}/applications/${sponsorApp}/refund`).set(...auth(adminToken)).send({});
    expect(nothingLeft.status).toBe(409);
    row = await appRow(sponsorApp);
    expect(row.status).toBe('APPROVED'); // refund never changes the review status
  });

  // ─── Dashboard refunds reach Orders (EVE-30) ─────────────────────────────

  // Builds a fresh paid application so the refund assertions below start clean.
  async function paidApplication(email, intentSuffix) {
    const tier = submitForm.tiers[0];
    const created = await submit('sponsors', tier.id, `${email}@${TAG}.test`, 'Ledger Co');
    const id = created.body.applicationId;
    const row = await appRow(id);
    const paymentIntentId = `pi_${TAG}_${intentSuffix}`;
    await webhook(checkoutCompleted({ id: row.stripeCheckoutSessionId, mode: 'payment', payment_status: 'paid', payment_intent: paymentIntentId, metadata: { applicationId: id, purpose: 'submit' } }));
    return { id, paymentIntentId };
  }

  it('refund.* events carry the refund directly and settle the ledger; pending is recorded but not counted, failed is never counted', async () => {
    const { id, paymentIntentId } = await paidApplication('pending', 'pending');
    const chargeId = `ch_${TAG}_pending`;

    // refund.created while the refund is still in flight: recorded, not counted.
    const pending = { id: `re_${TAG}_pending`, payment_intent: paymentIntentId, charge: chargeId, amount: 30000, status: 'pending', reason: null };
    expect((await webhook(refundEvent('refund.created', pending))).status).toBe(200);
    let row = await appRow(id);
    expect(row.refunds).toHaveLength(1);
    expect(row.refunds[0]).toMatchObject({ stripeRefundId: `re_${TAG}_pending`, status: 'PENDING' });
    expect(row.paymentStatus).toBe('PAID'); // no money counted as returned yet

    // refund.updated says it settled: the same row is promoted, not duplicated.
    expect((await webhook(refundEvent('refund.updated', { ...pending, status: 'succeeded' }))).status).toBe(200);
    row = await appRow(id);
    expect(row.refunds).toHaveLength(1);
    expect(row.refunds[0]).toMatchObject({ status: 'SUCCEEDED' });
    expect(Number(row.refunds[0].amount)).toBe(300);
    expect(row.paymentStatus).toBe('PARTIALLY_REFUNDED');

    // charge.refund.updated redelivering the settled state is a no-op.
    expect((await webhook(refundEvent('charge.refund.updated', { ...pending, status: 'succeeded' }))).status).toBe(200);
    expect((await appRow(id)).refunds).toHaveLength(1);

    // A refund that failed at the bank was never money out: nothing recorded.
    expect((await webhook(refundEvent('refund.created', { id: `re_${TAG}_failed`, payment_intent: paymentIntentId, charge: chargeId, amount: 10000, status: 'failed', reason: null }))).status).toBe(200);
    expect((await appRow(id)).refunds).toHaveLength(1);

    // No payment_intent inlined: the handler reads it back off the charge.
    mockChargesRetrieve.mockResolvedValue({ id: chargeId, payment_intent: paymentIntentId });
    expect((await webhook(refundEvent('refund.created', { id: `re_${TAG}_nopi`, payment_intent: null, charge: chargeId, amount: 5000, status: 'succeeded', reason: null }))).status).toBe(200);
    expect(mockChargesRetrieve).toHaveBeenCalledWith(chargeId, undefined);
    expect((await appRow(id)).refunds).toHaveLength(2);
  });

  it('a refund whose Stripe response is lost is retried onto the same Stripe refund, not a second one', async () => {
    const { id, paymentIntentId } = await paidApplication('retry', 'retry');

    // The refund reaches Stripe; the response does not come back.
    const timeout = new Error('Request aborted due to timeout');
    timeout.type = 'StripeConnectionError';
    mockRefundsCreate.mockRejectedValueOnce(timeout);

    const failed = await request(app).post(`${adminBase()}/applications/${id}/refund`).set(...auth(adminToken)).send({ amount: 250 });
    expect(failed.status).toBe(400);
    const firstCall = mockRefundsCreate.mock.calls.at(-1);

    // The row stays PENDING — marking it FAILED would hide it from the
    // remaining-refundable guard and invite a second refund — and PENDING is
    // excluded from refunded totals, so nothing is counted as returned yet.
    let row = await appRow(id);
    expect(row.refunds).toHaveLength(1);
    expect(row.refunds[0]).toMatchObject({ status: 'PENDING', stripeRefundId: null });
    expect(Number(row.refunds[0].amount)).toBe(250);
    expect(row.paymentStatus).toBe('PAID');

    // The admin retries. Same idempotency key, so Stripe returns the refund it
    // already made instead of issuing a second one.
    const retry = await request(app).post(`${adminBase()}/applications/${id}/refund`).set(...auth(adminToken)).send({ amount: 250 });
    expect(retry.status).toBe(200);
    const retryCall = mockRefundsCreate.mock.calls.at(-1);
    expect(retryCall[1].idempotencyKey).toBe(firstCall[1].idempotencyKey);

    // One refund on the ledger, not two: the PENDING row was reused.
    row = await appRow(id);
    expect(row.refunds).toHaveLength(1);
    expect(row.refunds[0]).toMatchObject({ status: 'SUCCEEDED' });
    expect(Number(row.refunds[0].amount)).toBe(250);
    expect(row.paymentStatus).toBe('PARTIALLY_REFUNDED');

    // A genuine second refund of the same amount is a different key, so Stripe
    // does issue it — the key must not collapse distinct refunds.
    const second = await request(app).post(`${adminBase()}/applications/${id}/refund`).set(...auth(adminToken)).send({ amount: 250 });
    expect(second.status).toBe(200);
    expect(mockRefundsCreate.mock.calls.at(-1)[1].idempotencyKey).not.toBe(retryCall[1].idempotencyKey);
    expect((await appRow(id)).refunds).toHaveLength(2);
  });

  // ─── Connect routing ─────────────────────────────────────────────────────

  it('with an active connected account the approval charge is a destination charge with applicantPays − orgReceives as the fee; refunds reverse the transfer', async () => {
    process.env.STRIPE_CONNECT_ENABLED = 'true';
    await prisma.organizationStripeAccount.create({
      data: { organizationId: org.id, mode: 'test', stripeAccountId: ACCT, chargesEnabled: true, transfersEnabled: true, payoutsEnabled: true, detailsSubmitted: true },
    });
    const tier = approvalForm.tiers.find((t) => t.name === '10x10');
    const created = await submit('vendor-space', tier.id, `connected@${TAG}.test`, 'Routed Co');
    const id = created.body.applicationId;
    await cardOnFile(id);

    const res = await request(app).post(`${adminBase()}/applications/${id}/decision`).set(...auth(organizerToken)).send({ decision: 'APPROVE' });
    expect(res.status).toBe(200);
    const row = await appRow(id);
    const expectedFee = Math.round(Number(row.applicantPays) * 100) - Math.round(Number(row.orgReceives) * 100);
    const params = mockIntentsCreate.mock.calls.at(-1)[0];
    expect(params.transfer_data).toEqual({ destination: ACCT });
    expect(params.application_fee_amount).toBe(expectedFee);
    expect(res.body.payment).toMatchObject({ stripeAccountId: ACCT, applicationFee: expectedFee / 100 });

    const refund = await request(app).post(`${adminBase()}/applications/${id}/refund`).set(...auth(adminToken)).send({ amount: 50 });
    expect(refund.status).toBe(200);
    expect(mockRefundsCreate.mock.calls.at(-1)[0]).toMatchObject({ amount: 5000, reverse_transfer: true, refund_application_fee: true });

    await prisma.organizationStripeAccount.deleteMany({ where: { organizationId: org.id } });
    delete process.env.STRIPE_CONNECT_ENABLED;
  });

  // ─── Webhook dispatch + state guards ─────────────────────────────────────

  it('ticket checkout sessions (no applicationId) never reach the application handler', async () => {
    const before = await prisma.application.findMany({ where: { organizationId: org.id }, select: { id: true, updatedAt: true } });
    const res = await webhook(checkoutCompleted({ id: 'cs_ticket_order', mode: 'payment', payment_status: 'paid', payment_intent: 'pi_ticket', metadata: { orderId: 'nope' } }));
    expect(res.status).toBe(200);
    const after = await prisma.application.findMany({ where: { organizationId: org.id }, select: { id: true, updatedAt: true } });
    expect(after).toEqual(before);
  });

  it('payment_intent.payment_failed after a PROCESSING charge moves to PAYMENT_DUE once; withdraw releases the reserved slot', async () => {
    const tier = approvalForm.tiers.find((t) => t.name === '10x10');
    const created = await submit('vendor-space', tier.id, `slow@${TAG}.test`, 'Slow Card');
    const id = created.body.applicationId;
    await cardOnFile(id);
    sentEmails.length = 0;
    mockIntentsCreate.mockResolvedValueOnce({ id: `pi_${TAG}_slow`, status: 'processing' });
    const res = await request(app).post(`${adminBase()}/applications/${id}/decision`).set(...auth(organizerToken)).send({ decision: 'APPROVE' });
    expect(res.body).toMatchObject({ status: 'APPROVED', paymentStatus: 'PROCESSING', capacitySlot: 'RESERVED' });
    expect(sentEmails).toHaveLength(0); // the webhook decides which email goes out

    // While processing, no other decision is allowed
    const blocked = await request(app).post(`${adminBase()}/applications/${id}/decision`).set(...auth(organizerToken)).send({ decision: 'WITHDRAW' });
    expect(blocked.status).toBe(409);

    const failed = { id: 'evt_fail', type: 'payment_intent.payment_failed', data: { object: { id: `pi_${TAG}_slow`, status: 'requires_payment_method', last_payment_error: { message: 'Insufficient funds' }, metadata: { applicationId: id, purpose: 'approval' } } } };
    expect((await webhook(failed)).status).toBe(200);
    expect((await webhook(failed)).status).toBe(200);
    const row = await appRow(id);
    expect(row).toMatchObject({ paymentStatus: 'PAYMENT_DUE', capacitySlot: 'RESERVED' });
    expect(sentEmails.map((e) => e.subject)).toEqual([expect.stringMatching(/Payment needed/)]);
    const dueDecisions = await prisma.applicationDecision.findMany({ where: { applicationId: id, action: 'PAYMENT_DUE' } });
    expect(dueDecisions).toHaveLength(1);

    const before = await prisma.applicationTier.findUnique({ where: { id: tier.id } });
    const withdraw = await request(app).post(`${adminBase()}/applications/${id}/decision`).set(...auth(organizerToken)).send({ decision: 'WITHDRAW', note: 'Never paid' });
    expect(withdraw.body).toMatchObject({ status: 'WITHDRAWN', capacitySlot: 'NONE', paymentStatus: 'PAYMENT_DUE' });
    const after = await prisma.applicationTier.findUnique({ where: { id: tier.id } });
    expect(after.quantityReserved).toBe(before.quantityReserved - 1);
  });

  // ─── Overdue sweep ───────────────────────────────────────────────────────

  it('overdue sweep withdraws (WITHDRAW) or flags (HOLD) past-due applications and releases the slot', async () => {
    const tier = approvalForm.tiers.find((t) => t.name === '10x10');
    const holdForm = await request(app)
      .post(`${adminBase()}/application-forms`)
      .set(...auth(adminToken))
      .send({ kind: 'PAID', name: 'Hold Vendors', chargeTiming: 'APPROVAL', overduePolicy: 'HOLD', status: 'DRAFT', tiers: [{ name: 'Hold', price: 50, quantityTotal: 5 }] });
    await request(app).patch(`${adminBase()}/application-forms/${holdForm.body.id}`).set(...auth(adminToken)).send({ status: 'OPEN' });

    const mk = async (slug, tierId, email) => {
      const created = await submit(slug, tierId, email, `Overdue ${email}`);
      await cardOnFile(created.body.applicationId);
      mockIntentsCreate.mockRejectedValueOnce(cardDecline());
      await request(app)
        .post(`${adminBase()}/applications/${created.body.applicationId}/decision`)
        .set(...auth(organizerToken))
        .send({ decision: 'APPROVE' });
      await setDueAt(created.body.applicationId, new Date(Date.now() - 60_000));
      return created.body.applicationId;
    };
    const withdrawId = await mk('vendor-space', tier.id, `overdue1@${TAG}.test`);
    const holdId = await mk('hold-vendors', holdForm.body.tiers[0].id, `overdue2@${TAG}.test`);
    const notYet = await submit('vendor-space', tier.id, `overdue3@${TAG}.test`, 'Still In Time');
    await cardOnFile(notYet.body.applicationId);
    mockIntentsCreate.mockRejectedValueOnce(cardDecline());
    await request(app).post(`${adminBase()}/applications/${notYet.body.applicationId}/decision`).set(...auth(organizerToken)).send({ decision: 'APPROVE' });

    sentEmails.length = 0;
    const reservedBefore = (await prisma.applicationTier.findUnique({ where: { id: tier.id } })).quantityReserved;
    const result = await applicationPaymentService.sweepOverdue();
    expect(result).toEqual({ withdrawn: 1, held: 1 });

    const w = await appRow(withdrawId);
    expect(w).toMatchObject({ status: 'WITHDRAWN', paymentStatus: 'PAYMENT_DUE', overdue: true, withdrawnBy: 'SYSTEM', withdrawReason: 'payment_overdue', capacitySlot: 'NONE' });
    const h = await appRow(holdId);
    expect(h).toMatchObject({ status: 'APPROVED', paymentStatus: 'PAYMENT_DUE', overdue: true, capacitySlot: 'RESERVED' });
    const n = await appRow(notYet.body.applicationId);
    expect(n).toMatchObject({ status: 'APPROVED', overdue: false });
    expect((await prisma.applicationTier.findUnique({ where: { id: tier.id } })).quantityReserved).toBe(reservedBefore - 1);
    expect(sentEmails.map((e) => e.subject)).toEqual([expect.stringMatching(/withdrawn/)]);

    // Second sweep: nothing left
    expect(await applicationPaymentService.sweepOverdue()).toEqual({ withdrawn: 0, held: 0 });
  });

  // ─── Buyer account ───────────────────────────────────────────────────────

  it('buyer: pay-now and update-card from the account; withdraw blocked while a charge is processing', async () => {
    const { default: buyerAuthService } = await import('../../src/services/BuyerAuthService.js');
    const tier = approvalForm.tiers.find((t) => t.name === '10x10');
    const email = `buyer@${TAG}.test`;
    const created = await submit('vendor-space', tier.id, email, 'Buyer Co');
    const id = created.body.applicationId;
    await cardOnFile(id);
    const contact = await prisma.contact.findUnique({ where: { organizationId_email: { organizationId: org.id, email } } });
    const token = buyerAuthService.signSession({ contactId: contact.id, organizationId: org.id, email: contact.email });

    const update = await request(app).post(`/buyer/me/applications/${id}/update-card`).set('Authorization', `Bearer ${token}`);
    expect(update.status).toBe(200);
    expect(update.body.url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    const params = mockSessionsCreate.mock.calls.at(-1)[0];
    expect(params).toMatchObject({ mode: 'setup', metadata: { applicationId: id, purpose: 'update_card' } });

    // New card arrives: payment method replaced, status untouched
    await webhook(checkoutCompleted({ id: 'cs_update', mode: 'setup', setup_intent: 'seti_new', customer: contact.stripeCustomerId, metadata: { applicationId: id, purpose: 'update_card' } }));
    expect((await appRow(id)).stripePaymentMethodId).toBe(`pm_${TAG}_seti_new`);
    expect((await appRow(id)).status).toBe('SUBMITTED');

    const noBalance = await request(app).post(`/buyer/me/applications/${id}/pay`).set('Authorization', `Bearer ${token}`);
    expect(noBalance.status).toBe(409);

    mockIntentsCreate.mockRejectedValueOnce(cardDecline());
    await request(app).post(`${adminBase()}/applications/${id}/decision`).set(...auth(organizerToken)).send({ decision: 'APPROVE' });
    const pay = await request(app).post(`/buyer/me/applications/${id}/pay`).set('Authorization', `Bearer ${token}`);
    expect(pay.status).toBe(200);
    expect(mockSessionsCreate.mock.calls.at(-1)[0]).toMatchObject({ mode: 'payment', metadata: { applicationId: id, purpose: 'pay_now' } });

    const mine = await request(app).get('/buyer/me/applications').set('Authorization', `Bearer ${token}`);
    expect(mine.body.data.find((a) => a.id === id)).toMatchObject({ canPay: true, canUpdateCard: true, canWithdraw: false, paymentStatus: 'PAYMENT_DUE' });
  });
});
