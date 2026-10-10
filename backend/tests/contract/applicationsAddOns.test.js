// Contract tests for add-ons on applications (spec 012 phase 2), on the
// spec 037 phase 5 flow — add-ons are chosen with the space after approval:
// tier attachments and the public form payload, selection lines + order math
// (PASS / ABSORB with a taxable mix), reservation at selection with a
// sold-out 409 that holds nothing, line edits on a held space with the
// ADD_ONS_CHANGED email, itemised Stripe charges, releases on a lapsed hold /
// decline / withdraw / overdue, list filter + CSV columns, event duplication.
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
const mockCustomersCreate = jest.fn();
const mockIntentsCreate = jest.fn();
const mockIntentsRetrieve = jest.fn();
const mockSetupIntentsRetrieve = jest.fn();
const mockRefundsCreate = jest.fn();

jest.unstable_mockModule('../../src/config/stripe.js', () => ({
  default: {
    checkout: { sessions: { create: mockSessionsCreate, retrieve: jest.fn(), expire: mockSessionsExpire } },
    customers: { create: mockCustomersCreate },
    paymentIntents: { create: mockIntentsCreate, retrieve: mockIntentsRetrieve },
    setupIntents: { retrieve: mockSetupIntentsRetrieve },
    refunds: { create: mockRefundsCreate },
    webhooks: { constructEvent: jest.fn() },
  },
}));

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');
const { appRow: loadRow, cleanupApplicationOrders } = await import('../helpers/applicationRow.js');
const { default: paymentSettingsService } =
  await import('../../src/services/PaymentSettingsService.js');
const { default: applicationPaymentService } =
  await import('../../src/services/ApplicationPaymentService.js');
const { default: applicationDigestService } =
  await import('../../src/services/ApplicationDigestService.js');
const { default: paymentService } = await import('../../src/services/PaymentService.js');
const { default: feeService } = await import('../../src/services/FeeService.js');
const { applicationAmounts } = await import('../../src/services/ApplicationFormService.js');
const { statusToken } = await import('../../src/services/applicationLinks.js');

const TAG = 'appaddons-ct';

paymentSettingsService._statusCache = {
  value: { provider: 'STRIPE', mode: 'test', charges: 'active', statementDescriptorPrefix: 'JUMP', capabilities: {}, manageUrl: '', radarUrl: '', error: null },
  expiresAt: Number.POSITIVE_INFINITY,
};

let sessionN = 0;
let customerN = 0;
let intentN = 0;

function resetStripeMocks() {
  mockSessionsCreate.mockReset().mockImplementation(async (params) => {
    sessionN += 1;
    return { id: `cs_${TAG}_${sessionN}`, url: `https://checkout.stripe.com/c/pay/cs_${TAG}_${sessionN}`, mode: params.mode, metadata: params.metadata };
  });
  mockSessionsExpire.mockReset().mockImplementation(async (id) => ({ id, status: 'expired' }));
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
  mockRefundsCreate.mockReset();
}

function cardDecline() {
  const err = new Error('Your card was declined.');
  err.type = 'StripeCardError';
  err.code = 'card_declined';
  err.raw = { payment_intent: { id: `pi_${TAG}_declined_${++intentN}` } };
  return err;
}

async function webhook(event) {
  return request(app).post('/webhooks/stripe').set('Content-Type', 'application/json').send(JSON.stringify(event));
}
const checkoutCompleted = (session) => ({ id: `evt_${Math.random()}`, type: 'checkout.session.completed', data: { object: session } });

describe('Applications with add-ons (spec 012 phase 2)', () => {
  let adminToken;
  let organizerToken;
  let org;
  let eventId;
  let form; // PAID, APPROVAL timing, PASS, untaxed tier
  let absorbForm; // PAID, SUBMIT timing, ABSORB
  let booth; // tier, 5 spots
  let corner; // tier, 1 spot
  let gold; // absorb tier
  let power; // APPLICATION, all tiers, 2 total, untaxed, $125
  let badge; // APPLICATION, restricted to Booth, max 4, $10, untaxed
  let table; // BOTH, all tiers, taxable, $40
  let parking; // TICKET scope: never on applications
  const emails = [`admin@${TAG}.test`, `organizer@${TAG}.test`];
  const auth = (token) => ['Authorization', `Bearer ${token}`];
  const adminBase = () => `/admin/events/${eventId}`;
  const addOnBase = () => `/organizations/${org.id}/events/${eventId}/add-ons`;

  // Spec 037 phase 5: add-ons are chosen with the space, after approval.
  const submit = (formSlug, email, businessName = 'Hidden Block Games') =>
    request(app)
      .post(`/events/${eventId}/applications`)
      .send({ formSlug, contact: { email, firstName: 'Vee', lastName: 'Vendor' }, acceptances: allAcceptances(), profile: { businessName }, answers: {} });

  const appRow = (id) => loadRow(id, { tier: true, contact: true, decisions: true });
  const addOnRow = (id) => prisma.addOn.findUnique({ where: { id } });
  const tierRow = (id) => prisma.applicationTier.findUnique({ where: { id } });

  const decide = (id, decision, token = organizerToken, extra = {}) => request(app).post(`${adminBase()}/applications/${id}/decision`).set(...auth(token)).send({ decision, ...extra });
  const patchAddOns = (id, addOns, token = organizerToken) => request(app).patch(`${adminBase()}/applications/${id}/add-ons`).set(...auth(token)).send({ addOns });
  const select = (id, body = {}) => request(app).post(`/applications/${id}/select?token=${statusToken(id)}`).send(body);
  const pay = (id) => request(app).post(`/applications/${id}/pay?token=${statusToken(id)}`);

  /** Submitted and approved into `tierId`: AWAITING_SELECTION (the form reserves the slot). */
  async function approved(formSlug, tierId, email, businessName) {
    const res = await submit(formSlug, email, businessName);
    expect(res.status).toBe(201);
    const ok = await decide(res.body.applicationId, 'APPROVE', organizerToken, { tierId });
    expect(ok.status).toBe(200);
    return res.body.applicationId;
  }

  /** Approved and holding the chosen space with `addOns`: PAYMENT_DUE, order PENDING. */
  async function chosen(formSlug, tierId, email, addOns, businessName) {
    const id = await approved(formSlug, tierId, email, businessName);
    const res = await select(id, { addOns });
    expect(res.status).toBe(200);
    return id;
  }

  /** Settle the application's hosted Checkout the way Stripe's webhook does. */
  async function checkoutPaid(id, intentId) {
    const res = await webhook(checkoutCompleted({ id: (await appRow(id)).stripeCheckoutSessionId, mode: 'payment', payment_status: 'paid', payment_intent: intentId, metadata: { applicationId: id, purpose: 'pay_now' } }));
    expect(res.status).toBe(200);
    return appRow(id);
  }

  /** A card saved before apply-then-choose (a migrated row). */
  async function giveSavedCard(id) {
    const row = await appRow(id);
    await prisma.contact.update({ where: { id: row.contactId }, data: { stripeCustomerId: `cus_${TAG}_${row.contactId}` } });
    await prisma.application.update({ where: { id }, data: { stripePaymentMethodId: `pm_${TAG}_${id}` } });
  }

  beforeAll(async () => {
    process.env.APPLICATIONS_PAYMENTS_ENABLED = 'true';
    await prisma.organization.deleteMany({ where: { name: { startsWith: `${TAG} ` } } }).catch(() => {});
    adminToken = await staffToken({ email: emails[0], role: 'ADMIN' });
    organizerToken = await staffToken({ email: emails[1], role: 'ORGANIZER' });
    org = await prisma.organization.create({ data: { name: `${TAG} Makers`, email: `owner@${TAG}.test` } });
    await joinOrgByToken(adminToken, org.id, 'ADMIN');
    await joinOrgByToken(organizerToken, org.id, 'ORGANIZER');
    const venue = await prisma.venue.create({ data: { organizationId: org.id, name: `${TAG} Hall`, address: '1 Maker Way', city: 'Durham', state: 'NC' } });
    const event = await prisma.event.create({
      data: { venueId: venue.id, name: `${TAG} Fair 2027`, date: new Date('2027-10-02T15:00:00Z'), status: 'PUBLISHED', capacity: 500, taxRate: 0.1 },
    });
    eventId = event.id;

    const f = await request(app)
      .post(`${adminBase()}/application-forms`)
      .set(...auth(adminToken))
      .send({ kind: 'PAID', name: 'Vendor Booth', chargeTiming: 'APPROVAL', taxable: false, paymentDueDays: 5, tiers: [{ name: 'Booth', price: 275, quantityTotal: 5 }, { name: 'Corner', price: 400, quantityTotal: 1 }] });
    expect(f.status).toBe(201);
    form = f.body;
    booth = form.tiers.find((t) => t.name === 'Booth');
    corner = form.tiers.find((t) => t.name === 'Corner');
    const a = await request(app)
      .post(`${adminBase()}/application-forms`)
      .set(...auth(adminToken))
      .send({ kind: 'PAID', name: 'Sponsors', chargeTiming: 'SUBMIT', feeMode: 'ABSORB', taxable: true, tiers: [{ name: 'Gold', price: 1000, quantityTotal: 3 }] });
    expect(a.status).toBe(201);
    absorbForm = a.body;
    gold = absorbForm.tiers[0];
    for (const x of [form, absorbForm]) {
      const open = await request(app).patch(`${adminBase()}/application-forms/${x.id}`).set(...auth(adminToken)).send({ status: 'OPEN' });
      expect(open.status).toBe(200);
    }

    const create = (body) => request(app).post(addOnBase()).set(...auth(adminToken)).send(body);
    power = (await create({ name: 'Booth power', price: 125, scope: 'APPLICATION', quantityTotal: 2, taxable: false })).body;
    badge = (await create({ name: 'Extra vendor badge', price: 10, scope: 'APPLICATION', allTiers: false, maxPerOrder: 4, taxable: false })).body;
    table = (await create({ name: 'Table & chairs', price: 40, scope: 'BOTH', taxable: true })).body;
    parking = (await create({ name: 'Parking pass', price: 15, scope: 'TICKET' })).body;
    expect(power.id && badge.id && table.id && parking.id).toBeTruthy();
  });

  afterAll(async () => {
    delete process.env.APPLICATIONS_PAYMENTS_ENABLED;
    await prisma.paymentTransaction
      .deleteMany({ where: { order: { event: { venue: { organizationId: org.id } } } } })
      .catch(() => {});
    await prisma.ticket
      .deleteMany({ where: { event: { venue: { organizationId: org.id } } } })
      .catch(() => {});
    await prisma.order
      .deleteMany({ where: { event: { venue: { organizationId: org.id } } } })
      .catch(() => {});
    await cleanupApplicationOrders(org.id);
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

  // ─── Attachments + payloads ──────────────────────────────────────────────

  describe('tier attachments and payloads', () => {
    it('ADMIN attaches a restricted add-on to a tier; allTiers add-ons are offered everywhere; TICKET scope is refused', async () => {
      const forbidden = await request(app).put(`${adminBase()}/application-forms/${form.id}/tiers/${booth.id}/add-ons`).set(...auth(organizerToken)).send({ addOnIds: [badge.id] });
      expect(forbidden.status).toBe(403);

      const bad = await request(app).put(`${adminBase()}/application-forms/${form.id}/tiers/${booth.id}/add-ons`).set(...auth(adminToken)).send({ addOnIds: [parking.id] });
      expect(bad.status).toBe(400);

      const res = await request(app).put(`${adminBase()}/application-forms/${form.id}/tiers/${booth.id}/add-ons`).set(...auth(adminToken)).send({ addOnIds: [badge.id, power.id] });
      expect(res.status).toBe(200);
      expect(res.body.addOns.map((a) => a.name).sort()).toEqual(['Booth power', 'Extra vendor badge', 'Table & chairs']);

      const f = await request(app).get(`${adminBase()}/application-forms/${form.id}`).set(...auth(organizerToken));
      expect(f.status).toBe(200);
      const byName = Object.fromEntries(f.body.tiers.map((t) => [t.name, t]));
      expect(byName.Booth.addOns.map((a) => a.id).sort()).toEqual([badge.id, power.id, table.id].sort());
      expect(byName.Corner.addOns.map((a) => a.id).sort()).toEqual([power.id, table.id].sort());
      // Form-level list for the tier dialog: application add-ons only.
      expect(f.body.addOns.map((a) => a.id).sort()).toEqual([badge.id, power.id, table.id].sort());
      expect(f.body.addOns.find((a) => a.id === badge.id)).toMatchObject({ allTiers: false, scope: 'APPLICATION' });

      // The admin add-on view reflects the attachment too.
      const list = await request(app).get(addOnBase()).set(...auth(organizerToken));
      expect(list.body.addOns.find((a) => a.id === badge.id).applicationTierIds).toEqual([booth.id]);
    });

    it('public form lists each tier’s add-ons with a per-unit applicant price under the form’s fee mode', async () => {
      const res = await request(app).get(`/events/${eventId}/applications/forms/${form.slug}`);
      expect(res.status).toBe(200);
      const b = res.body.tiers.find((t) => t.id === booth.id);
      const c = res.body.tiers.find((t) => t.id === corner.id);
      expect(b.addOns.map((a) => a.name)).toEqual(['Booth power', 'Extra vendor badge', 'Table & chairs']);
      expect(c.addOns.map((a) => a.name)).toEqual(['Booth power', 'Table & chairs']);
      const p = b.addOns.find((a) => a.id === power.id);
      expect(p).toMatchObject({ price: 125, taxable: false, maxPerOrder: null, remaining: 2, soldOut: false });
      // PASS: fees on top; power is untaxed so no tax in its unit price.
      const unit = feeService.computeOrderFees([{ unitPrice: 125, quantity: 1, taxable: false }], 0.1);
      expect(p.applicantPays).toBe(unit.total);
      expect(unit.tax).toBe(0);
      const t = b.addOns.find((a) => a.id === table.id);
      const tUnit = feeService.computeOrderFees([{ unitPrice: 40, quantity: 1, taxable: true }], 0.1);
      expect(t.applicantPays).toBe(tUnit.total);
      expect(tUnit.tax).toBe(4);

      const ab = await request(app).get(`/events/${eventId}/applications/forms/${absorbForm.slug}`);
      const g = ab.body.tiers[0].addOns.find((a) => a.id === table.id);
      // ABSORB: listed price plus tax, fees come out of the organization's share.
      expect(g.applicantPays).toBe(44);
    });
  });

  // ─── Selection (spec 037 phase 5: add-ons are chosen with the space) ─────

  describe('selection', () => {
    it('rejects lines that are not offered, over the max, duplicated or unknown; nothing is held or ordered', async () => {
      const onBooth = await approved(form.slug, booth.id, `bad1@${TAG}.test`, 'Bad Booth');
      const onCorner = await approved(form.slug, corner.id, `bad2@${TAG}.test`, 'Bad Corner');
      const cases = [
        [onCorner, [{ addOnId: badge.id, quantity: 1 }], 400, /not offered/],
        [onBooth, [{ addOnId: parking.id, quantity: 1 }], 400, /not sold with applications/],
        [onBooth, [{ addOnId: badge.id, quantity: 5 }], 400, /Maximum quantity/],
        [onBooth, [{ addOnId: badge.id, quantity: 1 }, { addOnId: badge.id, quantity: 1 }], 400, /repeat/],
        [onBooth, [{ addOnId: 'nope', quantity: 1 }], 404, /not found/i],
        [onBooth, [{ addOnId: power.id, quantity: 0 }], 400, /quantity/],
        [onBooth, 'power', 400, /array/],
      ];
      for (const [id, addOns, status, re] of cases) {
        const res = await select(id, { addOns });
        expect([res.status, res.body.message]).toEqual([status, expect.stringMatching(re)]);
      }
      expect(await prisma.order.count({ where: { applicationId: { in: [onBooth, onCorner] } } })).toBe(0);
      expect((await addOnRow(power.id)).quantityReserved).toBe(0);
      // Free their approval slots (Corner has one) for the tests below.
      for (const id of [onBooth, onCorner]) expect((await decide(id, 'WITHDRAW', organizerToken, { sendEmail: false })).status).toBe(200);
      expect(await tierRow(corner.id)).toMatchObject({ quantityReserved: 0 });
    });

    let appA;

    it('PASS form: the order sums tier + add-on lines with tax on taxable lines only, each line keeps its share, and the lines are held', async () => {
      const boothBefore = await tierRow(booth.id);
      const id = await chosen(form.slug, booth.id, `a@${TAG}.test`, [{ addOnId: power.id, quantity: 1 }, { addOnId: badge.id, quantity: 2 }, { addOnId: table.id, quantity: 1 }]);
      appA = await appRow(id);
      expect(appA).toMatchObject({ status: 'APPROVED', paymentStatus: 'PAYMENT_DUE', capacitySlot: 'RESERVED' });
      expect(appA.addOns.map((l) => [l.addOn.name, l.quantity, Number(l.unitPrice)])).toEqual([
        ['Booth power', 1, 125],
        ['Extra vendor badge', 2, 10],
        ['Table & chairs', 1, 40],
      ]);

      const expected = feeService.computeOrderFees(
        [
          { unitPrice: 275, quantity: 1, taxable: false },
          { unitPrice: 125, quantity: 1, taxable: false },
          { unitPrice: 10, quantity: 2, taxable: false },
          { unitPrice: 40, quantity: 1, taxable: true },
        ],
        0.1
      );
      expect(Number(appA.subtotal)).toBe(460);
      expect(Number(appA.tax)).toBe(4);
      expect(Number(appA.applicantPays)).toBe(expected.total);
      expect(Number(appA.orgReceives)).toBe(460);
      expect(Number(appA.platformFee)).toBe(expected.platformFee);
      // Lines partition the total exactly.
      const lineSum = appA.addOns.reduce((s, l) => s + Number(l.applicantPays), 0);
      const tierLine = Math.round((expected.total - lineSum) * 100) / 100;
      expect(tierLine).toBe(expected.itemBreakdowns[0].lineTotal);
      expect(appA.addOns.map((l) => Number(l.applicantPays))).toEqual(expected.itemBreakdowns.slice(1).map((b) => b.lineTotal));
      // The chosen lines are held with the approval slot (taken once, at approval).
      expect(await addOnRow(power.id)).toMatchObject({ quantityReserved: 1, quantitySold: 0 });
      expect(await addOnRow(badge.id)).toMatchObject({ quantityReserved: 2 });
      expect((await tierRow(booth.id)).quantityReserved).toBe(boothBefore.quantityReserved + 1);
    });

    it('status view and admin detail expose the lines, editability and a pricing check that covers add-ons', async () => {
      const status = await request(app).get(`/applications/${appA.id}/status?token=${statusToken(appA.id)}`);
      expect(status.status).toBe(200);
      expect(status.body.addOns.map((l) => l.name)).toEqual(['Booth power', 'Extra vendor badge', 'Table & chairs']);
      expect(status.body.addOns[0]).toMatchObject({ addOnId: power.id, quantity: 1, unitPrice: 125 });
      expect(status.body.selection).toMatchObject({ state: 'HELD' });

      const detail = await request(app).get(`${adminBase()}/applications/${appA.id}`).set(...auth(organizerToken));
      expect(detail.status).toBe(200);
      expect(detail.body.addOns).toHaveLength(3);
      expect(detail.body.addOnsEditable).toEqual({ allowed: true, reason: null });
      expect(detail.body.pricing.changed).toBe(false);

      // Raise the power price: the pricing note now flags the delta and includes the line.
      await request(app).patch(`${addOnBase()}/${power.id}`).set(...auth(adminToken)).send({ price: 150 });
      const after = await request(app).get(`${adminBase()}/applications/${appA.id}`).set(...auth(organizerToken));
      expect(after.body.pricing.changed).toBe(true);
      expect(after.body.pricing.currentApplicantPays).toBeGreaterThan(Number(appA.applicantPays));
      expect(Number(after.body.amounts.applicantPays)).toBe(Number(appA.applicantPays));
      await request(app).patch(`${addOnBase()}/${power.id}`).set(...auth(adminToken)).send({ price: 125 });
    });

    it('the choose view offers the category’s add-ons with per-unit prices, and ABSORB Checkout itemises the tier and each line to the order total', async () => {
      const id = await approved(absorbForm.slug, gold.id, `absorb@${TAG}.test`, 'Gold Sponsor Co');
      const view = await request(app).get(`/applications/${id}/status?token=${statusToken(id)}`);
      expect(view.body.selection.addOns.map((a) => a.name)).toEqual(['Booth power', 'Table & chairs']);
      expect(view.body.selection.addOns.find((a) => a.id === table.id)).toMatchObject({ applicantPays: 44, remaining: null });

      expect((await select(id, { addOns: [{ addOnId: table.id, quantity: 2 }] })).status).toBe(200);
      const row = await appRow(id);
      // ABSORB + taxable form at 10%: listed 1000 + 80, tax 108 → applicant pays 1188.
      expect(Number(row.subtotal)).toBe(1080);
      expect(Number(row.tax)).toBe(108);
      expect(Number(row.applicantPays)).toBe(1188);
      expect(row.addOns).toHaveLength(1);
      expect(Number(row.addOns[0].applicantPays)).toBe(88);
      expect((await pay(id)).status).toBe(200);
      const session = mockSessionsCreate.mock.calls.at(-1)[0];
      expect(session.mode).toBe('payment');
      expect(session.line_items).toHaveLength(2);
      expect(session.line_items.map((l) => l.price_data.product_data.name)).toEqual([`${TAG} Fair 2027 — Sponsors (Gold)`, 'Table & chairs ×2']);
      expect(session.line_items.reduce((s, l) => s + l.price_data.unit_amount * l.quantity, 0)).toBe(118800);

      // The sponsor backs out and gives the space back: the tables are released and nothing is reported.
      await request(app).post(`/applications/${id}/cancel-checkout?token=${statusToken(id)}`);
      const released = await request(app).post(`/applications/${id}/release?token=${statusToken(id)}`);
      expect(released.body).toMatchObject({ released: true });
      expect((await addOnRow(table.id)).quantityReserved).toBe(1); // appA's table only
    });
  });

  // ─── Payment, capacity, edits ────────────────────────────────────────────

  describe('payment and line edits', () => {
    let appA; // 1 power, 2 badges, 1 table
    let appB; // wants 2 power
    let appC; // 1 power, card declines

    beforeAll(async () => {
      appA = await prisma.application.findFirst({ where: { organizationId: org.id, contact: { email: `a@${TAG}.test` } } });
      appB = { id: await approved(form.slug, booth.id, `b@${TAG}.test`, 'Two Plugs') };
      appC = { id: await approved(form.slug, booth.id, `c@${TAG}.test`, 'Declined Inc') };
    });

    it('paying the held space charges the itemised order and moves the add-ons to sold with the tier slot', async () => {
      const boothBefore = await tierRow(booth.id);
      expect((await pay(appA.id)).status).toBe(200);
      const session = mockSessionsCreate.mock.calls.at(-1)[0];
      expect(session.line_items.map((l) => l.price_data.product_data.name)).toEqual([`${TAG} Fair 2027 — Vendor Booth (Booth)`, 'Booth power ×1', 'Extra vendor badge ×2', 'Table & chairs ×1']);
      const row = await checkoutPaid(appA.id, `pi_${TAG}_a`);
      expect(row).toMatchObject({ status: 'APPROVED', paymentStatus: 'PAID', capacitySlot: 'APPROVED' });
      expect(session.line_items.reduce((s, l) => s + l.price_data.unit_amount * l.quantity, 0)).toBe(Math.round(Number(row.applicantPays) * 100));
      expect(await addOnRow(power.id)).toMatchObject({ quantitySold: 1, quantityReserved: 0 });
      expect(await addOnRow(badge.id)).toMatchObject({ quantitySold: 2, quantityReserved: 0 });
      expect(await tierRow(booth.id)).toMatchObject({ quantityApproved: boothBefore.quantityApproved + 1, quantityReserved: boothBefore.quantityReserved - 1 });
      const detail = await request(app).get(`${adminBase()}/applications/${appA.id}`).set(...auth(organizerToken));
      expect(detail.body.addOnsEditable).toMatchObject({ allowed: false, reason: expect.stringMatching(/paid/i) });
    });

    it('a sold-out add-on at selection returns 409 naming it and holds nothing', async () => {
      const boothBefore = await tierRow(booth.id);
      const res = await select(appB.id, { addOns: [{ addOnId: power.id, quantity: 2 }] });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('ADD_ON_SOLD_OUT');
      expect(res.body.message).toMatch(/Booth power is sold out: 2 requested, 1 left/);
      expect(res.body.details).toMatchObject({ addOnId: power.id, remaining: 1, requested: 2 });
      expect(await tierRow(booth.id)).toMatchObject({ quantityReserved: boothBefore.quantityReserved });
      expect(await addOnRow(power.id)).toMatchObject({ quantitySold: 1, quantityReserved: 0 });
      const row = await appRow(appB.id);
      expect(row).toMatchObject({ status: 'APPROVED', paymentStatus: 'AWAITING_SELECTION', capacitySlot: 'RESERVED', selectionHeldUntil: null, orderId: null });
    });

    it('ORGANIZER edits the lines of a held space before payment: order recomputed, ADD_ONS_CHANGED recorded and emailed; no-ops and paid rows are refused', async () => {
      const notYet = await patchAddOns(appB.id, [{ addOnId: power.id, quantity: 1 }]);
      expect(notYet.status).toBe(409); // no order until the vendor chooses
      expect((await select(appB.id, { addOns: [{ addOnId: power.id, quantity: 1 }] })).status).toBe(200);
      const before = await appRow(appB.id);
      const same = await patchAddOns(appB.id, [{ addOnId: power.id, quantity: 1 }]);
      expect(same.status).toBe(400);
      expect(same.body.message).toMatch(/Nothing changed/);

      const paid = await patchAddOns(appA.id, [{ addOnId: power.id, quantity: 1 }]);
      expect(paid.status).toBe(409);
      expect(paid.body.message).toMatch(/Already paid/);

      const bad = await patchAddOns(appB.id, [{ addOnId: parking.id, quantity: 1 }]);
      expect(bad.status).toBe(400);

      const res = await patchAddOns(appB.id, [{ addOnId: power.id, quantity: 1 }, { addOnId: table.id, quantity: 1 }]);
      expect(res.status).toBe(200);
      expect(res.body.addOns.map((l) => [l.name, l.quantity])).toEqual([['Booth power', 1], ['Table & chairs', 1]]);
      const expected = applicationAmounts(
        [{ price: 275, quantity: 1, taxable: false }, { price: 125, quantity: 1, taxable: false }, { price: 40, quantity: 1, taxable: true }],
        { feeMode: 'PASS', taxable: false },
        { taxRate: 0.1 },
        { taxInclusivePricing: false }
      );
      expect(res.body.amounts.applicantPays).toBe(expected.applicantPays);
      expect(res.body.amounts.applicantPays).not.toBe(Number(before.applicantPays));
      const change = res.body.decisions.find((d) => d.action === 'ADD_ONS_CHANGED');
      expect(change.note).toBe(`Add-ons: Booth power ×1 → Booth power ×1, Table & chairs ×1. Total $${Number(before.applicantPays).toFixed(2)} → $${expected.applicantPays.toFixed(2)}.`);
      expect(change.emailSubject).toMatch(/application was updated/);
      const mail = sentEmails.at(-1);
      expect(JSON.stringify(mail)).toMatch(/Booth power ×1 \(\$/);
      expect(JSON.stringify(mail)).toContain(`$${expected.applicantPays.toFixed(2)}`);
      expect(mockSessionsExpire).not.toHaveBeenCalled();
      // The holds follow the lines.
      expect(await addOnRow(power.id)).toMatchObject({ quantitySold: 1, quantityReserved: 1 });
      expect(await addOnRow(table.id)).toMatchObject({ quantityReserved: 1 });

      // Removing every line is a valid edit.
      const none = await patchAddOns(appB.id, []);
      expect(none.status).toBe(200);
      expect(none.body.addOns).toEqual([]);
      expect(none.body.amounts.orgReceives).toBe(275);
      // …and putting one back so the payment below sells it.
      const back = await patchAddOns(appB.id, [{ addOnId: power.id, quantity: 1 }], adminToken);
      expect(back.status).toBe(200);

      expect((await pay(appB.id)).status).toBe(200);
      const paidB = await checkoutPaid(appB.id, `pi_${TAG}_b`);
      expect(paidB.paymentStatus).toBe('PAID');
      expect(await addOnRow(power.id)).toMatchObject({ quantitySold: 2, quantityReserved: 0 });
    });

    it('a declined saved card releases the held lines; a line edit while paying is refused, after backing out it moves the holds', async () => {
      // Free a power unit for C: withdraw B (sold → released).
      const withdraw = await decide(appB.id, 'WITHDRAW');
      expect(withdraw.status).toBe(200);
      expect(await addOnRow(power.id)).toMatchObject({ quantitySold: 1, quantityReserved: 0 });

      await giveSavedCard(appC.id);
      mockIntentsCreate.mockImplementationOnce(async () => {
        throw cardDecline();
      });
      const declined = await select(appC.id, { addOns: [{ addOnId: power.id, quantity: 1 }, { addOnId: badge.id, quantity: 1 }], useSavedCard: true });
      expect(declined.status).toBe(200);
      expect(declined.body.paymentStatus).toBe('AWAITING_SELECTION');
      expect(await addOnRow(power.id)).toMatchObject({ quantitySold: 1, quantityReserved: 0 });
      expect(await addOnRow(badge.id)).toMatchObject({ quantitySold: 2, quantityReserved: 0 });
      const detail = await request(app).get(`${adminBase()}/applications/${appC.id}`).set(...auth(organizerToken));
      expect(detail.body).toMatchObject({ status: 'APPROVED', paymentStatus: 'AWAITING_SELECTION', capacitySlot: 'RESERVED' });
      expect(detail.body.addOnsEditable.allowed).toBe(false);

      // Chosen again, paid on Checkout: the session itemises the lines.
      expect((await select(appC.id, { addOns: [{ addOnId: power.id, quantity: 1 }, { addOnId: badge.id, quantity: 1 }] })).status).toBe(200);
      expect(await addOnRow(badge.id)).toMatchObject({ quantityReserved: 1 });
      expect((await pay(appC.id)).status).toBe(200);
      const payParams = mockSessionsCreate.mock.calls.at(-1)[0];
      expect(payParams.line_items.map((l) => l.price_data.product_data.name)).toEqual([`${TAG} Fair 2027 — Vendor Booth (Booth)`, 'Booth power ×1', 'Extra vendor badge ×1']);
      const sessionId = (await appRow(appC.id)).stripeCheckoutSessionId;
      expect(sessionId).toBeTruthy();
      const busy = await patchAddOns(appC.id, [{ addOnId: power.id, quantity: 1 }]);
      expect(busy.status).toBe(409);
      expect(busy.body.message).toMatch(/payment is in progress/);

      // The vendor backs out of Checkout (the session is expired); the organizer then drops the badge and adds a table.
      await request(app).post(`/applications/${appC.id}/cancel-checkout?token=${statusToken(appC.id)}`);
      expect(mockSessionsExpire).toHaveBeenCalledWith(sessionId);
      const edit = await patchAddOns(appC.id, [{ addOnId: power.id, quantity: 1 }, { addOnId: table.id, quantity: 1 }]);
      expect(edit.status).toBe(200);
      expect(edit.body).toMatchObject({ status: 'APPROVED', paymentStatus: 'PAYMENT_DUE', capacitySlot: 'RESERVED' });
      expect(await addOnRow(badge.id)).toMatchObject({ quantitySold: 2, quantityReserved: 0 });
      expect(await addOnRow(table.id)).toMatchObject({ quantityReserved: 1 });
      expect(await addOnRow(power.id)).toMatchObject({ quantitySold: 1, quantityReserved: 1 });
      expect((await appRow(appC.id)).stripeCheckoutSessionId).toBeNull();

      // Asking for more power than is left is refused and leaves the holds as they were.
      const tooMany = await patchAddOns(appC.id, [{ addOnId: power.id, quantity: 2 }]);
      expect(tooMany.status).toBe(409);
      expect(await addOnRow(power.id)).toMatchObject({ quantitySold: 1, quantityReserved: 1 });
      expect((await appRow(appC.id)).addOns.map((l) => l.addOn.name)).toEqual(['Booth power', 'Table & chairs']);

      // Paying the new amount sells the held lines.
      const row = await appRow(appC.id);
      expect((await pay(appC.id)).status).toBe(200);
      expect(await checkoutPaid(appC.id, `pi_${TAG}_paynow_c`)).toMatchObject({ paymentStatus: 'PAID', capacitySlot: 'APPROVED' });
      expect(await addOnRow(power.id)).toMatchObject({ quantitySold: 2, quantityReserved: 0 });
      // appA's table plus this one
      expect(await addOnRow(table.id)).toMatchObject({ quantitySold: 2, quantityReserved: 0 });
      expect(Number(row.applicantPays)).toBe(Number((await appRow(appC.id)).applicantPays));
    });

    it('a lapsed hold releases the held add-ons (the reserving form keeps the slot); the overdue sweep then withdraws and frees it', async () => {
      const appD = await chosen(form.slug, corner.id, `d@${TAG}.test`, [{ addOnId: table.id, quantity: 3 }], 'Overdue LLC');
      expect(await addOnRow(table.id)).toMatchObject({ quantitySold: 2, quantityReserved: 3 });
      expect(await tierRow(corner.id)).toMatchObject({ quantityReserved: 1 });

      await prisma.application.update({ where: { id: appD }, data: { selectionHeldUntil: new Date(Date.now() - 1000) } });
      expect((await applicationPaymentService.sweepExpiredSelections()).released).toBeGreaterThanOrEqual(1);
      expect(await addOnRow(table.id)).toMatchObject({ quantitySold: 2, quantityReserved: 0 });
      expect(await tierRow(corner.id)).toMatchObject({ quantityReserved: 1 });

      // Six days on: past this form's 5-day clock, inside the sponsors' 7.
      const swept = await applicationPaymentService.sweepOverdue(new Date(Date.now() + 6 * 86_400_000));
      expect(swept.withdrawn).toBeGreaterThanOrEqual(1);
      expect(await appRow(appD)).toMatchObject({ status: 'WITHDRAWN', capacitySlot: 'NONE', withdrawnBy: 'SYSTEM' });
      expect(await addOnRow(table.id)).toMatchObject({ quantitySold: 2, quantityReserved: 0 });
      expect(await tierRow(corner.id)).toMatchObject({ quantityReserved: 0, quantityApproved: 0 });
    });

    it('Connect unavailability never strands saved-card, pay-now, or retry flows in PROCESSING', async () => {
      const ids = [];
      const sessionsBefore = mockSessionsCreate.mock.calls.length;
      try {
        const savedCardId = await approved(form.slug, booth.id, `connect-saved@${TAG}.test`, 'Connect Saved LLC');
        ids.push(savedCardId);
        await giveSavedCard(savedCardId);

        const payNowId = await chosen(form.slug, booth.id, `connect-pay@${TAG}.test`, [], 'Connect Pay LLC');
        ids.push(payNowId);

        const retryId = await chosen(form.slug, booth.id, `connect-retry@${TAG}.test`, [], 'Connect Retry LLC');
        ids.push(retryId);
        await giveSavedCard(retryId);

        process.env.STRIPE_CONNECT_ENABLED = 'true';

        const saved = await select(savedCardId, { useSavedCard: true });
        expect(saved.status).toBe(409);
        expect(saved.body.code).toBe('PAYMENTS_UNAVAILABLE');
        expect(await appRow(savedCardId)).toMatchObject({ paymentStatus: 'PAYMENT_DUE' });

        const hosted = await pay(payNowId);
        expect(hosted.status).toBe(409);
        expect(hosted.body.code).toBe('PAYMENTS_UNAVAILABLE');
        expect(await appRow(payNowId)).toMatchObject({ paymentStatus: 'PAYMENT_DUE', stripeCheckoutSessionId: null });

        const retry = await request(app)
          .post(`${adminBase()}/applications/${retryId}/charge`)
          .set(...auth(organizerToken));
        expect(retry.status).toBe(409);
        expect(retry.body.code).toBe('PAYMENTS_UNAVAILABLE');
        expect(await appRow(retryId)).toMatchObject({ paymentStatus: 'PAYMENT_DUE' });

        expect(mockSessionsCreate).toHaveBeenCalledTimes(sessionsBefore);
        expect(mockIntentsCreate).not.toHaveBeenCalled();
      } finally {
        delete process.env.STRIPE_CONNECT_ENABLED;
        for (const id of ids) {
          await applicationPaymentService.releaseSelection(id, { reason: 'Test cleanup', force: true }).catch(() => {});
          await decide(id, 'WITHDRAW').catch(() => {});
        }
      }
    });
  });

  // ─── List, CSV, duplicate ────────────────────────────────────────────────

  describe('organizer views', () => {
    it('list rows carry a compact add-on summary and filter by add-on', async () => {
      const all = await request(app).get(`${adminBase()}/applications`).set(...auth(organizerToken));
      expect(all.status).toBe(200);
      const a = all.body.data.find((r) => r.businessName === 'Hidden Block Games');
      expect(a.addOns.map((l) => `${l.name} ×${l.quantity}`)).toEqual(['Booth power ×1', 'Extra vendor badge ×2', 'Table & chairs ×1']);

      const filtered = await request(app).get(`${adminBase()}/applications?addOn=${badge.id}`).set(...auth(organizerToken));
      expect(filtered.body.data.map((r) => r.businessName).sort()).toEqual(['Hidden Block Games']);
      const byTable = await request(app).get(`${adminBase()}/applications?addOn=${table.id}`).set(...auth(organizerToken));
      // Gold Sponsor Co gave its space back: the cancelled order's tables are not listed.
      expect(byTable.body.data.map((r) => r.businessName).sort()).toEqual(['Declined Inc', 'Hidden Block Games', 'Overdue LLC']);
    });

    it('CSV export has one column per add-on with the quantity', async () => {
      const res = await request(app).get(`${adminBase()}/applications/export.csv?form=${form.id}`).set(...auth(organizerToken));
      expect(res.status).toBe(200);
      const [header, ...rows] = res.text.split('\r\n');
      const cols = header.split(',');
      expect(cols).toEqual(expect.arrayContaining(['addon:Booth power', 'addon:Extra vendor badge', 'addon:Table & chairs']));
      const idx = (name) => cols.indexOf(name);
      const hidden = rows.map((r) => r.split(',')).find((r) => r[idx('businessName')] === 'Hidden Block Games');
      expect(hidden[idx('addon:Booth power')]).toBe('1');
      expect(hidden[idx('addon:Extra vendor badge')]).toBe('2');
      const plugs = rows.map((r) => r.split(',')).find((r) => r[idx('businessName')] === 'Two Plugs');
      expect(plugs[idx('addon:Extra vendor badge')]).toBe('');
    });

    it('sales report and purchasers CSV combine ticket orders and applications (phase 3)', async () => {
      // A ticket buyer takes two tables (BOTH scope) so the report mixes sources.
      const ga = await prisma.priceTier.create({ data: { eventId, name: 'GA', price: 20, quantityTotal: 50, displayOrder: 0 } });
      const order = await request(app)
        .post('/orders')
        .send({ eventId, items: [{ priceTierId: ga.id, quantity: 1 }], addOns: [{ addOnId: table.id, quantity: 2 }], contact: { email: `buyer@${TAG}.test`, firstName: 'Ada', lastName: 'Buyer' } });
      expect(order.status).toBe(201);
      await paymentService.handleCheckoutCompleted((await prisma.order.findUnique({ where: { id: order.body.orderId } })).stripeSessionId, `pi_${TAG}_order`);

      const forbidden = await request(app).get(`${addOnBase()}/sales`);
      expect(forbidden.status).toBe(401);
      const res = await request(app).get(`${addOnBase()}/sales`).set(...auth(organizerToken));
      expect(res.status).toBe(200);
      const byName = Object.fromEntries(res.body.addOns.map((r) => [r.name, r]));
      // Tables: A (1) + C (1) paid applications, 2 on the order; the withdrawn D and the released sponsor count nowhere.
      expect(byName['Table & chairs']).toMatchObject({ sold: 4, reserved: 0, remaining: null, revenue: 160, orders: { quantity: 2, revenue: 80, lines: 1 }, applications: { quantity: 2, revenue: 80, lines: 2, held: 0, pending: 0 } });
      expect(byName['Booth power']).toMatchObject({ sold: 2, reserved: 0, remaining: 0, quantityTotal: 2, revenue: 250, orders: { quantity: 0 }, applications: { quantity: 2, revenue: 250 } });
      expect(byName['Extra vendor badge']).toMatchObject({ sold: 2, revenue: 20, applications: { quantity: 2 } });
      expect(byName['Parking pass']).toMatchObject({ sold: 0, revenue: 0 });
      expect(res.body.totals).toEqual({ sold: 8, reserved: 0, revenue: 430 });

      const csv = await request(app).get(`${addOnBase()}/purchasers.csv`).set(...auth(organizerToken));
      expect(csv.status).toBe(200);
      expect(csv.headers['content-type']).toMatch(/text\/csv/);
      const [header, ...rows] = csv.text.split('\r\n');
      const cols = header.split(',');
      expect(cols).toEqual(['addOn', 'quantity', 'unitPrice', 'source', 'sourceId', 'status', 'firstName', 'lastName', 'email', 'businessName', 'form', 'tier', 'boothLabel', 'refunded', 'createdAt']);
      const parsed = rows.map((r) => Object.fromEntries(r.split(',').map((c, i) => [cols[i], c])));
      const orderRow = parsed.find((r) => r.source === 'order');
      expect(orderRow).toMatchObject({ addOn: 'Table & chairs', quantity: '2', unitPrice: '40.00', sourceId: order.body.orderId, status: 'COMPLETED', email: `buyer@${TAG}.test`, refunded: '' });
      const hidden = parsed.filter((r) => r.businessName === 'Hidden Block Games');
      expect(hidden.map((r) => `${r.addOn} ×${r.quantity}`).sort()).toEqual(['Booth power ×1', 'Extra vendor badge ×2', 'Table & chairs ×1']);
      expect(hidden[0]).toMatchObject({ source: 'application', status: 'APPROVED/PAID', form: 'Vendor Booth', tier: 'Booth' });
      // Withdrawn applications still appear (with their status); a released selection does not.
      expect(parsed.some((r) => r.businessName === 'Overdue LLC' && r.status.startsWith('WITHDRAWN'))).toBe(true);
      expect(parsed.some((r) => r.businessName === 'Gold Sponsor Co')).toBe(false);
    });

    it('the organizer digest counts add-ons per form and lists them per application (phase 3)', async () => {
      sentEmails.length = 0;
      const orgRow = await prisma.organization.findUnique({ where: { id: org.id }, select: { id: true, name: true, logoUrl: true, applicationDigestAt: true } });
      const sent = await applicationDigestService.sendForOrganization(orgRow, new Date());
      expect(sent).toBe(true);
      const body = String(sentEmails.at(-1)?.text || sentEmails.at(-1)?.html || '');
      // A (1 power, 2 badges, 1 table) + B (1 power) + C (1 power, 1 table) + D (3 tables)
      expect(body).toMatch(/Add-ons requested: Booth power ×3, Extra vendor badge ×2, Table &amp; chairs ×5|Add-ons requested: Booth power ×3, Extra vendor badge ×2, Table & chairs ×5/);
      expect(body).toMatch(/Hidden Block Games \(Vee Vendor\) — Booth, Booth power ×1, Extra vendor badge ×2, Table (&amp;|&) chairs ×1, \$/);
      await prisma.organization.update({ where: { id: org.id }, data: { applicationDigestAt: orgRow.applicationDigestAt } });
    });

    it('duplicating the event copies add-ons and their application-tier attachments', async () => {
      const res = await request(app).post(`/organizations/${org.id}/events/${eventId}/duplicate`).set(...auth(adminToken)).send({ date: '2028-10-02T15:00:00Z' });
      expect(res.status).toBe(201);
      const copyId = res.body.id;
      const forms = await request(app).get(`/admin/events/${copyId}/application-forms`).set(...auth(adminToken));
      const copied = forms.body.data.find((f) => f.name === 'Vendor Booth');
      const boothCopy = copied.tiers.find((t) => t.name === 'Booth');
      const cornerCopy = copied.tiers.find((t) => t.name === 'Corner');
      expect(boothCopy.addOns.map((a) => a.name)).toEqual(['Booth power', 'Extra vendor badge', 'Table & chairs']);
      expect(cornerCopy.addOns.map((a) => a.name)).toEqual(['Booth power', 'Table & chairs']);
      const addOns = await prisma.addOn.findMany({ where: { eventId: copyId }, include: { applicationTiers: true } });
      expect(addOns).toHaveLength(4);
      expect(addOns.every((a) => a.quantitySold === 0 && a.quantityReserved === 0)).toBe(true);
      expect(addOns.find((a) => a.name === 'Extra vendor badge').applicationTiers.map((p) => p.applicationTierId)).toEqual([boothCopy.id]);
    });
  });
});
