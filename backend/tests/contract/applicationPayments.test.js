// Contract tests for application payments — spec 011 phase 2 as reshaped by
// spec 037 phase 5 (vendor apply-then-choose). Every PAID form:
//   submit (no category, no card, no order) → approve (category assigned,
//   slot taken when the form reserves on approval, CHOOSE_SPACE email,
//   nothing charged) → choose a space (15-minute hold, order opened) → pay
//   (hosted Checkout, or a saved card off-session) → webhook settles it.
// Also: holds lapsing, declines, cancelled Checkout, Connect routing,
// refunds, webhook dispatch, the overdue sweep on the approval clock, the
// buyer account, and a legacy PAYMENT_DUE row still paying through pay-now.
// Stripe and Resend mocked; Postgres is real.

import { jest } from '@jest/globals';
import request from 'supertest';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';
import { allAcceptances } from '../helpers/legal.js';

const sentEmails = [];
jest.unstable_mockModule('../../src/config/resend.js', () => ({
  default: { emails: { send: jest.fn(async (msg) => { sentEmails.push(msg); return { id: 'mock' }; }) } },
}));

const mockSessionsCreate = jest.fn();
const mockSessionsExpire = jest.fn();
const mockSessionsRetrieve = jest.fn();
const mockCustomersCreate = jest.fn();
const mockIntentsCreate = jest.fn();
const mockIntentsRetrieve = jest.fn();
const mockSetupIntentsRetrieve = jest.fn();
const mockPaymentMethodsRetrieve = jest.fn();
const mockRefundsCreate = jest.fn();

jest.unstable_mockModule('../../src/config/stripe.js', () => ({
  default: {
    checkout: { sessions: { create: mockSessionsCreate, retrieve: mockSessionsRetrieve, expire: mockSessionsExpire } },
    customers: { create: mockCustomersCreate },
    paymentIntents: { create: mockIntentsCreate, retrieve: mockIntentsRetrieve },
    setupIntents: { retrieve: mockSetupIntentsRetrieve },
    paymentMethods: { retrieve: mockPaymentMethodsRetrieve },
    refunds: { create: mockRefundsCreate },
    webhooks: { constructEvent: jest.fn() },
  },
}));

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');
const { default: paymentSettingsService } = await import('../../src/services/PaymentSettingsService.js');
const { default: applicationPaymentService } = await import('../../src/services/ApplicationPaymentService.js');
const { statusToken } = await import('../../src/services/applicationLinks.js');
const { appRow: loadRow, attachOrder, cleanupApplicationOrders } = await import('../helpers/applicationRow.js');

const TAG = 'apppay-ct';
// EVE-3: every webhook delivery is now recorded and deduped on its Stripe
// event id, so a fixed id makes the *second* run of this suite a replay that
// never reaches a handler. Namespace them per run and clear them in afterAll.
const EVT = `evt_${TAG}_${Date.now()}${Math.floor(Math.random() * 1000)}`;
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
  mockSessionsExpire.mockReset().mockResolvedValue({ status: 'expired' });
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
  mockPaymentMethodsRetrieve.mockReset().mockImplementation(async (id) => ({ id, card: { brand: 'visa', last4: '4242' } }));
  mockRefundsCreate.mockReset().mockImplementation(async (params) => {
    refundN += 1;
    return { id: `re_${TAG}_${refundN}`, amount: params.amount, status: 'succeeded' };
  });
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

describe('Application payments contract (spec 011 phase 2, spec 037 phase 5)', () => {
  let adminToken;
  let organizerToken;
  let adminUserId;
  let org;
  let eventId;
  let vendorForm; // reserves on approval (default), two categories
  let sponsorForm; // ABSORB, one category
  let firstComeForm; // reserveOnApproval: false, one 1-space category
  const emails = [`admin@${TAG}.test`, `organizer@${TAG}.test`];
  const auth = (token) => ['Authorization', `Bearer ${token}`];
  const adminBase = () => `/admin/events/${eventId}`;
  const tierOf = (form, name) => form.tiers.find((t) => t.name === name);

  const submit = (formSlug, email, businessName = 'Hidden Block Games') =>
    request(app)
      .post(`/events/${eventId}/applications`)
      .send({ formSlug, contact: { email, firstName: 'Vee', lastName: 'Vendor' }, acceptances: allAcceptances(), profile: { businessName }, answers: {} });
  const approve = (id, body = {}) => request(app).post(`${adminBase()}/applications/${id}/decision`).set(...auth(organizerToken)).send({ decision: 'APPROVE', ...body });
  const select = (id, body = {}) => request(app).post(`/applications/${id}/select?token=${statusToken(id)}`).send(body);
  const pay = (id) => request(app).post(`/applications/${id}/pay?token=${statusToken(id)}`);
  const status = (id) => request(app).get(`/applications/${id}/status?token=${statusToken(id)}`);
  const appRow = (id) => loadRow(id, { tier: true, contact: true });
  const tierRow = (id) => prisma.applicationTier.findUnique({ where: { id } });

  /** Submit and approve into a category: AWAITING_SELECTION. */
  async function approved(slug, email, business, tierId) {
    const created = await submit(slug, email, business);
    expect(created.status).toBe(201);
    const res = await approve(created.body.applicationId, tierId ? { tierId } : {});
    expect(res.status).toBe(200);
    return created.body.applicationId;
  }

  /** A card saved before apply-then-choose (a migrated row): customer + payment method on file. */
  async function giveSavedCard(id) {
    const row = await appRow(id);
    if (!row.contact.stripeCustomerId) {
      await prisma.contact.update({ where: { id: row.contactId }, data: { stripeCustomerId: `cus_${TAG}_saved_${row.contactId}` } });
    }
    await prisma.application.update({ where: { id }, data: { stripePaymentMethodId: `pm_${TAG}_saved_${id}` } });
  }

  /** Settle a hosted Checkout the way Stripe's webhook does. */
  async function checkoutPaid(id, intentId) {
    const row = await appRow(id);
    const res = await webhook(checkoutCompleted({ id: row.stripeCheckoutSessionId, mode: 'payment', payment_status: 'paid', payment_intent: intentId, metadata: { applicationId: id, purpose: 'pay_now' } }));
    expect(res.status).toBe(200);
    return appRow(id);
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

    const create = async (body) => {
      const res = await request(app).post(`${adminBase()}/application-forms`).set(...auth(adminToken)).send(body);
      expect(res.status).toBe(201);
      return res.body;
    };
    vendorForm = await create({
      kind: 'PAID',
      name: 'Vendor Space',
      paymentDueDays: 5,
      tiers: [
        { name: '10x10', price: 275, quantityTotal: 20 },
        { name: 'Single slot', price: 100, quantityTotal: 1 },
      ],
    });
    sponsorForm = await create({ kind: 'PAID', name: 'Sponsors', feeMode: 'ABSORB', tiers: [{ name: 'Gold', price: 1000, quantityTotal: 2 }] });
    firstComeForm = await create({ kind: 'PAID', name: 'Food Trucks', reserveOnApproval: false, tiers: [{ name: 'Truck', price: 150, quantityTotal: 1 }] });
  });

  afterAll(async () => {
    delete process.env.APPLICATIONS_PAYMENTS_ENABLED;
    delete process.env.STRIPE_CONNECT_ENABLED;
    await prisma.stripeWebhookEvent
      .deleteMany({ where: { stripeEventId: { startsWith: EVT } } })
      .catch(() => {});
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

  it('a PAID form opens with the flag on and exposes paymentsEnabled and reserveOnApproval', async () => {
    for (const form of [vendorForm, sponsorForm, firstComeForm]) {
      const res = await request(app).patch(`${adminBase()}/application-forms/${form.id}`).set(...auth(adminToken)).send({ status: 'OPEN' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'OPEN', paymentsEnabled: true, acceptance: { open: true } });
    }
    expect(vendorForm.reserveOnApproval).toBe(true);
    expect(firstComeForm.reserveOnApproval).toBe(false);
    const bad = await request(app).patch(`${adminBase()}/application-forms/${vendorForm.id}`).set(...auth(adminToken)).send({ reserveOnApproval: 'yes' });
    expect(bad.status).toBe(400);
  });

  let mainApp;

  it('submission is SUBMITTED + NOT_DUE with no category, no order, no card step and the RECEIVED email', async () => {
    const res = await submit('vendor-space', `vendor1@${TAG}.test`);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ next: 'done', orderRef: null });
    expect(res.body.checkoutUrl).toBeUndefined();
    mainApp = res.body.applicationId;

    expect(mockSessionsCreate).not.toHaveBeenCalled();
    expect(mockCustomersCreate).not.toHaveBeenCalled();
    const row = await appRow(mainApp);
    expect(row).toMatchObject({ status: 'SUBMITTED', paymentStatus: 'NOT_DUE', capacitySlot: 'NONE', tierId: null, orderId: null, stripeCheckoutSessionId: null });
    expect(row.submittedAt).toBeTruthy();
    expect(await prisma.order.count({ where: { applicationId: mainApp } })).toBe(0);
    expect(sentEmails.map((e) => e.subject)).toEqual([expect.stringMatching(/received your application/)]);

    // Old clients may still send a category and add-ons: ignored on PAID forms.
    const legacy = await request(app)
      .post(`/events/${eventId}/applications`)
      .send({ formSlug: 'vendor-space', tierId: tierOf(vendorForm, '10x10').id, addOns: [], contact: { email: `legacy@${TAG}.test`, firstName: 'Le', lastName: 'Gacy' }, acceptances: allAcceptances(), profile: { businessName: 'Legacy Tab' }, answers: {} });
    expect(legacy.status).toBe(201);
    expect(await appRow(legacy.body.applicationId)).toMatchObject({ status: 'SUBMITTED', paymentStatus: 'NOT_DUE', tierId: null });

    const view = await status(mainApp);
    expect(view.body).toMatchObject({ status: 'SUBMITTED', paymentStatus: 'NOT_DUE', selection: null, canPay: false, canResume: false, canWithdraw: true });
    const list = await request(app).get(`${adminBase()}/applications`).set(...auth(organizerToken));
    expect(list.body.data.map((a) => a.id)).toContain(mainApp);
  });

  // ─── Approval ────────────────────────────────────────────────────────────

  it('approving needs a category when the form has several; approval reserves a slot, charges nothing and sends CHOOSE_SPACE', async () => {
    const missing = await approve(mainApp);
    expect(missing.status).toBe(400);
    expect(missing.body.code).toBe('CATEGORY_REQUIRED');

    const tier = tierOf(vendorForm, '10x10');
    const preview = await request(app).post(`${adminBase()}/applications/${mainApp}/preview`).set(...auth(organizerToken)).send({ decision: 'APPROVE', tierId: tier.id });
    expect(preview.status).toBe(200);
    expect(preview.body.subject).toMatch(/choose your space/);
    expect(preview.body.body).toContain('10x10');

    sentEmails.length = 0;
    const res = await approve(mainApp, { tierId: tier.id });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'APPROVED', paymentStatus: 'AWAITING_SELECTION', capacitySlot: 'RESERVED', tier: { id: tier.id, name: '10x10' }, orderId: null, selectionHeldUntil: null });
    expect(res.body.form.reserveOnApproval).toBe(true);
    expect(res.body.categories.map((c) => c.name)).toEqual(['10x10', 'Single slot']);
    const days = (new Date(res.body.payment.paymentDueAt).getTime() - Date.now()) / 86_400_000;
    // Five days out, rounded up to the end of that day in the organization zone.
    expect(days).toBeGreaterThan(4.9);
    expect(days).toBeLessThan(6);
    expect(res.body.decisions.at(-1)).toMatchObject({ action: 'APPROVED', emailSubject: expect.stringMatching(/choose your space/) });

    expect(mockIntentsCreate).not.toHaveBeenCalled();
    expect(mockSessionsCreate).not.toHaveBeenCalled();
    expect(await tierRow(tier.id)).toMatchObject({ quantityReserved: 1, quantityApproved: 0 });
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].subject).toMatch(/choose your space/);
    expect(sentEmails[0].text).toContain(`/apply/status/${mainApp}?token=${statusToken(mainApp)}`);
    expect(sentEmails[0].text).toContain('10x10');
  });

  it('the status page offers the category from the list: price, spaces left, due date; no map without one', async () => {
    const res = await status(mainApp);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'APPROVED', paymentStatus: 'AWAITING_SELECTION', canPay: false, orderRef: null });
    const sel = res.body.selection;
    expect(sel).toMatchObject({
      state: 'CHOOSE',
      heldUntil: null,
      reserveOnApproval: true,
      category: { name: '10x10', price: 275, guaranteed: true, spacesLeft: 19 },
      addOns: [],
      map: { available: false },
      placedBooth: null,
      savedCard: null,
    });
    expect(sel.category.applicantPays).toBeGreaterThan(275);
    expect(sel.dueAt).toBeTruthy();
  });

  it('choosing from the list holds the space 15 minutes and opens the order; Checkout pays it and the webhook settles the slot', async () => {
    const tier = tierOf(vendorForm, '10x10');
    const chosen = await select(mainApp, {});
    expect(chosen.status).toBe(200);
    expect(chosen.body).toMatchObject({ boothId: null, paymentStatus: 'PAYMENT_DUE', orderRef: expect.stringMatching(/^JMP-[A-Z2-9]{6}$/) });
    const holdMinutes = (new Date(chosen.body.holdExpiresAt).getTime() - Date.now()) / 60_000;
    expect(holdMinutes).toBeGreaterThan(14);
    expect(holdMinutes).toBeLessThan(15.1);

    let row = await appRow(mainApp);
    expect(row).toMatchObject({ status: 'APPROVED', paymentStatus: 'PAYMENT_DUE', capacitySlot: 'RESERVED', orderStatus: 'PENDING', orgReceives: 275 });
    expect(row.selectionHeldUntil).toBeTruthy();
    // The approval slot is the one used: nothing more is reserved.
    expect(await tierRow(tier.id)).toMatchObject({ quantityReserved: 1, quantityApproved: 0 });
    const order = await prisma.order.findUnique({ where: { id: row.orderId } });
    const clockDays = (order.dueAt.getTime() - Date.now()) / 86_400_000;
    expect(clockDays).toBeGreaterThan(4.9); // the approval clock, not a new one

    // A second choice while holding is refused.
    const twice = await select(mainApp, {});
    expect(twice.status).toBe(409);
    expect(twice.body.code).toBe('NOT_AWAITING_SELECTION');

    const view = await status(mainApp);
    expect(view.body).toMatchObject({ canPay: true, selection: { state: 'HELD' } });
    expect(view.body.selection.heldUntil).toBeTruthy();

    const checkout = await pay(mainApp);
    expect(checkout.status).toBe(200);
    expect(checkout.body.url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    const params = mockSessionsCreate.mock.calls.at(-1)[0];
    expect(params).toMatchObject({ mode: 'payment', metadata: { applicationId: mainApp, purpose: 'pay_now', orderRef: chosen.body.orderRef } });
    expect(params.line_items[0]).toMatchObject({ quantity: 1, price_data: { unit_amount: Math.round(Number(row.applicantPays) * 100) } });
    expect(params.payment_intent_data).toMatchObject({ statement_descriptor_suffix: 'GEEK EXPO', metadata: { applicationId: mainApp, purpose: 'pay_now' } });
    expect(params.success_url).toMatch(/checkout=paid$/);
    expect((await appRow(mainApp)).paymentStatus).toBe('PROCESSING');

    // PROCESSING protects the hold from the sweep even past its deadline.
    await prisma.application.update({ where: { id: mainApp }, data: { selectionHeldUntil: new Date(Date.now() - 1000) } });
    await applicationPaymentService.sweepExpiredSelections();
    expect(await appRow(mainApp)).toMatchObject({ paymentStatus: 'PROCESSING', orderStatus: 'PENDING' });

    sentEmails.length = 0;
    row = await checkoutPaid(mainApp, `pi_${TAG}_list`);
    expect(row).toMatchObject({ status: 'APPROVED', paymentStatus: 'PAID', capacitySlot: 'APPROVED', orderStatus: 'COMPLETED', stripePaymentIntentId: `pi_${TAG}_list`, selectionHeldUntil: null, paymentDueAt: null });
    expect(await tierRow(tier.id)).toMatchObject({ quantityReserved: 0, quantityApproved: 1 });
    expect(sentEmails.map((e) => e.subject)).toEqual([expect.stringMatching(/^Receipt for .* \(JMP-[A-Z2-9]{6}\)$/), expect.stringMatching(/approved/)]);

    const again = await pay(mainApp);
    expect(again.status).toBe(409);
  });

  it('a full category refuses the approval with a Waitlist suggestion; concurrent approvals let exactly one through', async () => {
    const tier = tierOf(vendorForm, 'Single slot');
    const ids = [];
    for (const n of [1, 2]) ids.push((await submit('vendor-space', `single${n}@${TAG}.test`, `Single ${n}`)).body.applicationId);
    const results = await Promise.all(ids.map((id) => approve(id, { tierId: tier.id })));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const loser = results.find((r) => r.status === 409);
    expect(loser.body.message).toMatch(/Single slot is full/);
    expect(loser.body.details.suggestion).toBe('WAITLIST');
    expect(await tierRow(tier.id)).toMatchObject({ quantityReserved: 1, quantityApproved: 0 });
    const loserId = ids[results.indexOf(loser)];
    expect(await appRow(loserId)).toMatchObject({ status: 'SUBMITTED', paymentStatus: 'NOT_DUE', capacitySlot: 'NONE' });
    const waitlist = await request(app).post(`${adminBase()}/applications/${loserId}/decision`).set(...auth(organizerToken)).send({ decision: 'WAITLIST' });
    expect(waitlist.status).toBe(200);
    expect(mockIntentsCreate).not.toHaveBeenCalled();
  });

  // ─── reserveOnApproval: false ────────────────────────────────────────────

  it('a first-come form approves without a slot; choosing takes it; the next vendor gets SOLD_OUT; a lapsed hold frees it', async () => {
    const tier = firstComeForm.tiers[0];
    const first = await approved('food-trucks', `truck1@${TAG}.test`, 'Taco Truck'); // one category: auto-assigned
    const second = await approved('food-trucks', `truck2@${TAG}.test`, 'Waffle Wagon');
    expect(await appRow(first)).toMatchObject({ paymentStatus: 'AWAITING_SELECTION', capacitySlot: 'NONE', tierId: tier.id });
    expect(await tierRow(tier.id)).toMatchObject({ quantityReserved: 0, quantityApproved: 0 });
    expect((await status(first)).body.selection).toMatchObject({ reserveOnApproval: false, category: { guaranteed: false, spacesLeft: 1 } });

    const held = await select(first, {});
    expect(held.status).toBe(200);
    expect(await tierRow(tier.id)).toMatchObject({ quantityReserved: 1 });
    const firstRef = held.body.orderRef;

    const soldOut = await select(second, {});
    expect(soldOut.status).toBe(409);
    expect(soldOut.body.code).toBe('SOLD_OUT');
    expect(await appRow(second)).toMatchObject({ paymentStatus: 'AWAITING_SELECTION', orderId: null });

    // The hold lapses: slot, order and state go back.
    await prisma.application.update({ where: { id: first }, data: { selectionHeldUntil: new Date(Date.now() - 1000) } });
    expect((await applicationPaymentService.sweepExpiredSelections()).released).toBeGreaterThanOrEqual(1);
    const lapsed = await prisma.application.findUnique({ where: { id: first }, include: { order: true } });
    expect(lapsed).toMatchObject({ paymentStatus: 'AWAITING_SELECTION', capacitySlot: 'NONE', selectionHeldUntil: null });
    expect(lapsed.order.status).toBe('CANCELLED');
    expect(await tierRow(tier.id)).toMatchObject({ quantityReserved: 0 });
    expect((await appRow(first)).orderId).toBeNull(); // the cancelled order is not the live amount

    // Now the second vendor can take it; the first re-choosing reuses its order number.
    expect((await select(second, {})).status).toBe(200);
    const released = await request(app).post(`/applications/${second}/release?token=${statusToken(second)}`);
    expect(released.body).toMatchObject({ released: true, paymentStatus: 'AWAITING_SELECTION' });
    const again = await select(first, {});
    expect(again.status).toBe(200);
    expect(again.body.orderRef).toBe(firstRef);
    expect(await prisma.order.count({ where: { applicationId: first } })).toBe(1);
  });

  // ─── Saved card (kept from before apply-then-choose) ─────────────────────

  let cardApp;

  it('a saved card is offered at selection and charged off-session (descriptor suffix, idempotency key)', async () => {
    cardApp = await approved('vendor-space', `card@${TAG}.test`, 'Card Co', tierOf(vendorForm, '10x10').id);
    await giveSavedCard(cardApp);
    const view = await status(cardApp);
    expect(view.body.selection.savedCard).toEqual({ brand: 'visa', last4: '4242' });
    expect(view.body.hasCardOnFile).toBe(true);

    const res = await select(cardApp, { useSavedCard: true });
    expect(res.status).toBe(200);
    expect(res.body.paymentStatus).toBe('PAID');
    const row = await appRow(cardApp);
    expect(row).toMatchObject({ status: 'APPROVED', paymentStatus: 'PAID', capacitySlot: 'APPROVED', orderStatus: 'COMPLETED', chargeAttempts: 1 });
    const [params, options] = mockIntentsCreate.mock.calls[0];
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
    expect(options).toEqual({ idempotencyKey: `application:${cardApp}:charge:1` });

    // payment_intent.succeeded after the fact is idempotent
    const before = sentEmails.length;
    await webhook({ id: `${EVT}_pi_ok`, type: 'payment_intent.succeeded', data: { object: { id: row.stripePaymentIntentId, status: 'succeeded', metadata: { applicationId: cardApp, purpose: 'approval' } } } });
    expect(sentEmails).toHaveLength(before);
  });

  it('a declined saved card releases the chosen space back to the choice (slot kept on a reserving form) and records the failure', async () => {
    const tier = tierOf(vendorForm, '10x10');
    const id = await approved('vendor-space', `declined@${TAG}.test`, 'Declined Co', tier.id);
    await giveSavedCard(id);
    const reserved = (await tierRow(tier.id)).quantityReserved;
    mockIntentsCreate.mockRejectedValueOnce(cardDecline());
    const res = await select(id, { useSavedCard: true });
    expect(res.status).toBe(200);
    expect(res.body.paymentStatus).toBe('AWAITING_SELECTION');
    const row = await prisma.application.findUnique({ where: { id }, include: { order: { include: { payment: true } } } });
    expect(row).toMatchObject({ paymentStatus: 'AWAITING_SELECTION', capacitySlot: 'RESERVED', selectionHeldUntil: null });
    expect(row.order).toMatchObject({ status: 'CANCELLED' });
    expect(row.order.payment).toMatchObject({ status: 'FAILED', failureReason: 'Your card was declined.' });
    expect((await tierRow(tier.id)).quantityReserved).toBe(reserved);

    // Choose again and pay on Checkout instead.
    expect((await select(id, {})).status).toBe(200);
    expect((await pay(id)).status).toBe(200);
    const paid = await checkoutPaid(id, `pi_${TAG}_retry`);
    expect(paid).toMatchObject({ paymentStatus: 'PAID', orderStatus: 'COMPLETED', stripePaymentIntentId: `pi_${TAG}_retry` });
  });

  it('a Checkout whose webhook never arrived is reconciled with Stripe once its session must have ended', async () => {
    const lost = await approved('vendor-space', `lost@${TAG}.test`, 'Lost Hook Co', tierOf(vendorForm, '10x10').id);
    await select(lost, {});
    await pay(lost);
    const paidOne = await approved('vendor-space', `lost2@${TAG}.test`, 'Paid Hook Co', tierOf(vendorForm, '10x10').id);
    await select(paidOne, {});
    await pay(paidOne);
    const longAgo = new Date(Date.now() - 60 * 60_000);
    await prisma.application.updateMany({ where: { id: { in: [lost, paidOne] } }, data: { selectionHeldUntil: longAgo } });
    const sessions = {
      [(await appRow(lost)).stripeCheckoutSessionId]: { status: 'expired', payment_status: 'unpaid', expires_at: Math.floor(longAgo.getTime() / 1000) },
      [(await appRow(paidOne)).stripeCheckoutSessionId]: { status: 'complete', payment_status: 'paid', payment_intent: `pi_${TAG}_late`, metadata: { applicationId: paidOne, purpose: 'pay_now' } },
    };
    mockSessionsRetrieve.mockImplementation(async (id) => (sessions[id] ? { id, ...sessions[id] } : null));

    await applicationPaymentService.sweepExpiredSelections();
    expect(await appRow(lost)).toMatchObject({ paymentStatus: 'AWAITING_SELECTION', selectionHeldUntil: null, orderId: null });
    expect(await appRow(paidOne)).toMatchObject({ paymentStatus: 'PAID', capacitySlot: 'APPROVED', orderStatus: 'COMPLETED', stripePaymentIntentId: `pi_${TAG}_late` });
    mockSessionsRetrieve.mockReset();
  });

  it('backing out of Checkout keeps the hold while it runs; an expired session releases it', async () => {
    const id = await approved('vendor-space', `backout@${TAG}.test`, 'Back Out Co', tierOf(vendorForm, '10x10').id);
    await select(id, {});
    await pay(id);
    const row = await appRow(id);
    expect(row.paymentStatus).toBe('PROCESSING');

    const cancel = await request(app).post(`/applications/${id}/cancel-checkout?token=${statusToken(id)}`);
    expect(cancel.body).toMatchObject({ cancelled: true, paymentStatus: 'PAYMENT_DUE' });
    expect(mockSessionsExpire).toHaveBeenCalledWith(row.stripeCheckoutSessionId);
    expect((await appRow(id)).selectionHeldUntil).toBeTruthy();

    // Pay again, then Stripe expires that session: the space goes back.
    await pay(id);
    const session = (await appRow(id)).stripeCheckoutSessionId;
    const expired = await webhook({ id: `${EVT}_exp`, type: 'checkout.session.expired', data: { object: { id: session, mode: 'payment', metadata: { applicationId: id, purpose: 'pay_now' } } } });
    expect(expired.status).toBe(200);
    expect(await appRow(id)).toMatchObject({ paymentStatus: 'AWAITING_SELECTION', selectionHeldUntil: null, orderId: null });
    expect((await prisma.order.findFirst({ where: { applicationId: id } })).status).toBe('CANCELLED');
  });

  // ─── Refunds (ABSORB) ────────────────────────────────────────────────────

  let sponsorApp;

  it('ABSORB: the sponsor pays the listed price; refunds are ADMIN only, partial then full; charge.refunded is idempotent', async () => {
    sponsorApp = await approved('sponsors', `sponsor@${TAG}.test`, 'MegaCorp');
    await select(sponsorApp, {});
    const row = await appRow(sponsorApp);
    expect(Number(row.applicantPays)).toBe(1000);
    expect(Number(row.orgReceives)).toBeLessThan(1000);
    await pay(sponsorApp);
    expect(mockSessionsCreate.mock.calls.at(-1)[0].line_items[0].price_data.unit_amount).toBe(100000);
    await checkoutPaid(sponsorApp, `pi_${TAG}_sponsor`);

    const forbidden = await request(app).post(`${adminBase()}/applications/${sponsorApp}/refund`).set(...auth(organizerToken)).send({ amount: 100 });
    expect(forbidden.status).toBe(403);
    const bad = await request(app).post(`${adminBase()}/applications/${sponsorApp}/refund`).set(...auth(adminToken)).send({ amount: 5000 });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toMatch(/cannot exceed/);

    const partial = await request(app).post(`${adminBase()}/applications/${sponsorApp}/refund`).set(...auth(adminToken)).send({ amount: 250, reason: 'Smaller booth' });
    expect(partial.status).toBe(200);
    expect(partial.body).toMatchObject({ status: 'APPROVED', paymentStatus: 'PARTIALLY_REFUNDED' });
    expect(partial.body.payment).toMatchObject({ refundedTotal: 250, refundable: 750, canRefund: true });
    expect(partial.body.refunds[0]).toMatchObject({ amount: 250, status: 'SUCCEEDED', reason: 'Smaller booth', initiatedBy: adminUserId });
    expect(mockRefundsCreate.mock.calls[0][0]).toMatchObject({ payment_intent: `pi_${TAG}_sponsor`, amount: 25000, reason: 'requested_by_customer', metadata: { applicationId: sponsorApp } });

    const hook = await webhook({
      id: `${EVT}_refund`,
      type: 'charge.refunded',
      data: { object: { id: 'ch_1', payment_intent: `pi_${TAG}_sponsor`, refunds: { data: [{ id: `re_${TAG}_1`, amount: 25000, reason: null }, { id: 're_external', amount: 10000, reason: 'duplicate' }] } } },
    });
    expect(hook.status).toBe(200);
    expect((await appRow(sponsorApp)).refunds).toHaveLength(2);

    const full = await request(app).post(`${adminBase()}/applications/${sponsorApp}/refund`).set(...auth(adminToken)).send({});
    expect(full.status).toBe(200);
    expect(full.body).toMatchObject({ paymentStatus: 'REFUNDED' });
    expect(full.body.payment).toMatchObject({ refundedTotal: 1000, refundable: 0, canRefund: false });
    expect(mockRefundsCreate.mock.calls.at(-1)[0].amount).toBe(65000);
    expect((await request(app).post(`${adminBase()}/applications/${sponsorApp}/refund`).set(...auth(adminToken)).send({})).status).toBe(409);
    expect((await appRow(sponsorApp)).status).toBe('APPROVED');
  });

  // ─── Connect routing ─────────────────────────────────────────────────────

  it('with an active connected account the saved-card charge stays on the platform until spec 047 S5', async () => {
    process.env.STRIPE_CONNECT_ENABLED = 'true';
    await prisma.organizationStripeAccount.create({
      data: { organizationId: org.id, mode: 'test', stripeAccountId: ACCT, chargesEnabled: true, transfersEnabled: true, payoutsEnabled: true, detailsSubmitted: true },
    });
    const id = await approved('vendor-space', `connected@${TAG}.test`, 'Routed Co', tierOf(vendorForm, '10x10').id);
    await giveSavedCard(id);
    const res = await select(id, { useSavedCard: true });
    expect(res.body.paymentStatus).toBe('PAID');
    const params = mockIntentsCreate.mock.calls.at(-1)[0];
    expect(params.transfer_data).toBeUndefined();
    expect(params.application_fee_amount).toBeUndefined();
    expect(await appRow(id)).toMatchObject({ stripeAccountId: null, applicationFee: null });
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

  it('payment_intent.payment_failed after a PROCESSING saved-card charge releases the space once and emails PAYMENT_DUE; withdraw releases the slot', async () => {
    const tier = tierOf(vendorForm, '10x10');
    const id = await approved('vendor-space', `slow@${TAG}.test`, 'Slow Card', tier.id);
    await giveSavedCard(id);
    sentEmails.length = 0;
    mockIntentsCreate.mockResolvedValueOnce({ id: `pi_${TAG}_slow`, status: 'processing' });
    const res = await select(id, { useSavedCard: true });
    expect(res.body.paymentStatus).toBe('PROCESSING');
    expect(sentEmails).toHaveLength(0);

    const blocked = await request(app).post(`${adminBase()}/applications/${id}/decision`).set(...auth(organizerToken)).send({ decision: 'WITHDRAW' });
    expect(blocked.status).toBe(409);

    const failed = { type: 'payment_intent.payment_failed', data: { object: { id: `pi_${TAG}_slow`, status: 'requires_payment_method', last_payment_error: { message: 'Insufficient funds' }, metadata: { applicationId: id, purpose: 'approval' } } } };
    // Two distinct event ids carrying the same failure (Stripe re-emits): the
    // webhook ledger lets both through, so this exercises the handler's own idempotency.
    expect((await webhook({ ...failed, id: `${EVT}_fail_a` })).status).toBe(200);
    expect((await webhook({ ...failed, id: `${EVT}_fail_b` })).status).toBe(200);
    expect(await appRow(id)).toMatchObject({ paymentStatus: 'AWAITING_SELECTION', capacitySlot: 'RESERVED', selectionHeldUntil: null });
    expect(sentEmails.map((e) => e.subject)).toEqual([expect.stringMatching(/Payment needed/)]);
    expect(await prisma.applicationDecision.count({ where: { applicationId: id, action: 'PAYMENT_DUE' } })).toBe(1);

    const before = await tierRow(tier.id);
    const withdraw = await request(app).post(`${adminBase()}/applications/${id}/decision`).set(...auth(organizerToken)).send({ decision: 'WITHDRAW', note: 'Never paid' });
    expect(withdraw.body).toMatchObject({ status: 'WITHDRAWN', capacitySlot: 'NONE' });
    expect((await tierRow(tier.id)).quantityReserved).toBe(before.quantityReserved - 1);
  });

  // ─── Overdue sweep (clock starts at approval) ────────────────────────────

  it('overdue sweep: vendors who never chose are withdrawn (WITHDRAW) or flagged (HOLD) paymentDueDays after approval', async () => {
    const tier = tierOf(vendorForm, '10x10');
    const holdForm = await request(app)
      .post(`${adminBase()}/application-forms`)
      .set(...auth(adminToken))
      .send({ kind: 'PAID', name: 'Hold Vendors', overduePolicy: 'HOLD', paymentDueDays: 3, tiers: [{ name: 'Hold', price: 50, quantityTotal: 5 }] });
    await request(app).patch(`${adminBase()}/application-forms/${holdForm.body.id}`).set(...auth(adminToken)).send({ status: 'OPEN' });

    const late = (days) => new Date(Date.now() - days * 86_400_000 - 60_000);
    const withdrawId = await approved('vendor-space', `overdue1@${TAG}.test`, 'Overdue One', tier.id);
    // A full day past the due day: the clock runs to the end of that day.
    await prisma.application.update({ where: { id: withdrawId }, data: { decidedAt: late(6) } });
    const holdId = await approved('hold-vendors', `overdue2@${TAG}.test`, 'Overdue Two');
    await prisma.application.update({ where: { id: holdId }, data: { decidedAt: late(4) } });
    const inTime = await approved('vendor-space', `overdue3@${TAG}.test`, 'Still In Time', tier.id);
    await prisma.application.update({ where: { id: inTime }, data: { decidedAt: late(4) } }); // 4 of 5 days

    sentEmails.length = 0;
    const reservedBefore = (await tierRow(tier.id)).quantityReserved;
    expect(await applicationPaymentService.sweepOverdue()).toEqual({ withdrawn: 1, held: 1 });
    expect(await appRow(withdrawId)).toMatchObject({ status: 'WITHDRAWN', overdue: true, withdrawnBy: 'SYSTEM', withdrawReason: 'payment_overdue', capacitySlot: 'NONE' });
    expect(await appRow(holdId)).toMatchObject({ status: 'APPROVED', paymentStatus: 'AWAITING_SELECTION', overdue: true, capacitySlot: 'RESERVED' });
    expect(await appRow(inTime)).toMatchObject({ status: 'APPROVED', overdue: false });
    expect((await tierRow(tier.id)).quantityReserved).toBe(reservedBefore - 1);
    expect(sentEmails.map((e) => e.subject)).toEqual([expect.stringMatching(/withdrawn/)]);
    expect(await applicationPaymentService.sweepOverdue()).toEqual({ withdrawn: 0, held: 0 });

    // A flagged vendor can still choose and pay (the organizer decided to hold).
    expect((await select(holdId, {})).status).toBe(200);
  });

  // ─── Buyer account ───────────────────────────────────────────────────────

  it('buyer: chooses and pays from the account; update-card works for a kept card; withdraw is only before a decision', async () => {
    const { default: buyerAuthService } = await import('../../src/services/BuyerAuthService.js');
    const email = `buyer@${TAG}.test`;
    const id = (await submit('vendor-space', email, 'Buyer Co')).body.applicationId;
    await giveSavedCard(id);
    const contact = await prisma.contact.findUnique({ where: { organizationId_email: { organizationId: org.id, email } } });
    const token = buyerAuthService.signSession({ contactId: contact.id, organizationId: org.id, email: contact.email });
    const bearer = ['Authorization', `Bearer ${token}`];

    const update = await request(app).post(`/buyer/me/applications/${id}/update-card`).set(...bearer);
    expect(update.status).toBe(200);
    expect(mockSessionsCreate.mock.calls.at(-1)[0]).toMatchObject({ mode: 'setup', metadata: { applicationId: id, purpose: 'update_card' } });
    await webhook(checkoutCompleted({ id: 'cs_update', mode: 'setup', setup_intent: 'seti_new', customer: contact.stripeCustomerId, metadata: { applicationId: id, purpose: 'update_card' } }));
    expect(await appRow(id)).toMatchObject({ stripePaymentMethodId: `pm_${TAG}_seti_new`, status: 'SUBMITTED', paymentStatus: 'NOT_DUE' });

    const early = await request(app).post(`/buyer/me/applications/${id}/select`).set(...bearer).send({});
    expect(early.status).toBe(409);

    await approve(id, { tierId: tierOf(vendorForm, '10x10').id });
    const mine = await request(app).get('/buyer/me/applications').set(...bearer);
    expect(mine.body.data.find((a) => a.id === id)).toMatchObject({ paymentStatus: 'AWAITING_SELECTION', canWithdraw: false, selection: { state: 'CHOOSE' } });

    const chosen = await request(app).post(`/buyer/me/applications/${id}/select`).set(...bearer).send({});
    expect(chosen.status).toBe(200);
    const payRes = await request(app).post(`/buyer/me/applications/${id}/pay`).set(...bearer);
    expect(payRes.status).toBe(200);
    expect(mockSessionsCreate.mock.calls.at(-1)[0]).toMatchObject({ mode: 'payment', metadata: { applicationId: id, purpose: 'pay_now' } });

    // Someone else's application is not found.
    const otherId = (await submit('vendor-space', `other@${TAG}.test`, 'Other Co')).body.applicationId;
    expect((await request(app).post(`/buyer/me/applications/${otherId}/select`).set(...bearer).send({})).status).toBe(404);
  });

  // ─── Legacy rows (approved before apply-then-choose, before the backfill) ─

  it('a legacy APPROVED + PAYMENT_DUE row without a hold still pays through pay-now', async () => {
    const tier = tierOf(vendorForm, '10x10');
    const contact = await prisma.contact.create({ data: { organizationId: org.id, email: `legacy-due@${TAG}.test`, firstName: 'Old', lastName: 'Row' } });
    const profile = await prisma.applicantProfile.create({ data: { organizationId: org.id, contactId: contact.id, businessName: 'Legacy Due' } });
    const legacy = await prisma.application.create({
      data: { formId: vendorForm.id, eventId, organizationId: org.id, contactId: contact.id, profileId: profile.id, tierId: tier.id, status: 'APPROVED', paymentStatus: 'PAYMENT_DUE', capacitySlot: 'RESERVED', decidedAt: new Date(), submittedAt: new Date(), statusTokenHash: `legacy-${TAG}-${Date.now()}` },
    });
    await prisma.applicationTier.update({ where: { id: tier.id }, data: { quantityReserved: { increment: 1 } } });
    await attachOrder(legacy.id, { dueAt: new Date(Date.now() + 86_400_000) });

    expect((await status(legacy.id)).body).toMatchObject({ canPay: true, selection: null });
    expect((await pay(legacy.id)).status).toBe(200);
    expect((await appRow(legacy.id)).paymentStatus).toBe('PAYMENT_DUE'); // no hold, no PROCESSING guard
    const paid = await checkoutPaid(legacy.id, `pi_${TAG}_legacy`);
    expect(paid).toMatchObject({ paymentStatus: 'PAID', capacitySlot: 'APPROVED', orderStatus: 'COMPLETED' });
  });
});
