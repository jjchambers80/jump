// Contract tests for add-ons on applications (spec 012 phase 2): tier
// attachments and the public form payload, submission lines + snapshot math
// (PASS / ABSORB with a taxable mix), approval reservation with a sold-out
// 409 that rolls the tier back, line edits per state with the
// ADD_ONS_CHANGED email, itemised Stripe charges, releases on withdraw /
// overdue, list filter + CSV columns, and event duplication.
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

  const submit = (formSlug, tierId, email, addOns, businessName = 'Hidden Block Games') =>
    request(app)
      .post(`/events/${eventId}/applications`)
      .send({ formSlug, tierId, contact: { email, firstName: 'Vee', lastName: 'Vendor' }, acceptances: allAcceptances(), profile: { businessName }, answers: {}, ...(addOns !== undefined && { addOns }) });

  const appRow = (id) => loadRow(id, { tier: true, contact: true, decisions: true });
  const addOnRow = (id) => prisma.addOn.findUnique({ where: { id } });
  const tierRow = (id) => prisma.applicationTier.findUnique({ where: { id } });

  /** DRAFT card-on-file → SUBMITTED via the setup webhook. */
  async function cardOnFile(applicationId) {
    const row = await appRow(applicationId);
    const res = await webhook(
      checkoutCompleted({ id: row.stripeCheckoutSessionId, mode: 'setup', setup_intent: `seti_${applicationId}`, customer: row.contact.stripeCustomerId, metadata: { applicationId, purpose: 'submit' } })
    );
    expect(res.status).toBe(200);
    return appRow(applicationId);
  }

  const decide = (id, decision, token = organizerToken) => request(app).post(`${adminBase()}/applications/${id}/decision`).set(...auth(token)).send({ decision });
  const patchAddOns = (id, addOns, token = organizerToken) => request(app).patch(`${adminBase()}/applications/${id}/add-ons`).set(...auth(token)).send({ addOns });

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

  // ─── Submission ──────────────────────────────────────────────────────────

  describe('submission', () => {
    it('rejects lines that are not offered, over the max, duplicated, unknown, or on a FREE form', async () => {
      const cases = [
        [{ formSlug: form.slug, tierId: corner.id, addOns: [{ addOnId: badge.id, quantity: 1 }] }, 400, /not offered/],
        [{ formSlug: form.slug, tierId: booth.id, addOns: [{ addOnId: parking.id, quantity: 1 }] }, 400, /not sold with applications/],
        [{ formSlug: form.slug, tierId: booth.id, addOns: [{ addOnId: badge.id, quantity: 5 }] }, 400, /Maximum quantity/],
        [{ formSlug: form.slug, tierId: booth.id, addOns: [{ addOnId: badge.id, quantity: 1 }, { addOnId: badge.id, quantity: 1 }] }, 400, /repeat/],
        [{ formSlug: form.slug, tierId: booth.id, addOns: [{ addOnId: 'nope', quantity: 1 }] }, 404, /not found/i],
        [{ formSlug: form.slug, tierId: booth.id, addOns: [{ addOnId: power.id, quantity: 0 }] }, 400, /quantity/],
        [{ formSlug: form.slug, tierId: booth.id, addOns: 'power' }, 400, /array/],
      ];
      for (const [body, status, re] of cases) {
        const res = await request(app)
          .post(`/events/${eventId}/applications`)
          .send({ contact: { email: `bad@${TAG}.test`, firstName: 'B', lastName: 'B' }, acceptances: allAcceptances(), profile: { businessName: 'Bad' }, answers: {}, ...body });
        expect([res.status, res.body.message]).toEqual([status, expect.stringMatching(re)]);
      }
      expect(await prisma.application.count({ where: { organizationId: org.id } })).toBe(0);
    });

    let appA;

    it('PASS form: the snapshot sums tier + add-on lines with tax on taxable lines only, and each line keeps its share', async () => {
      const res = await submit(form.slug, booth.id, `a@${TAG}.test`, [{ addOnId: power.id, quantity: 1 }, { addOnId: badge.id, quantity: 2 }, { addOnId: table.id, quantity: 1 }]);
      expect(res.status).toBe(201);
      expect(res.body.next).toBe('checkout');
      appA = await appRow(res.body.applicationId);
      expect(appA.status).toBe('DRAFT');
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
      // Nothing is held at submission.
      expect((await addOnRow(power.id)).quantityReserved).toBe(0);
      expect((await tierRow(booth.id)).quantityReserved).toBe(0);

      appA = await cardOnFile(appA.id);
      expect(appA).toMatchObject({ status: 'SUBMITTED', paymentStatus: 'CARD_ON_FILE' });
      // The received email names the add-ons.
      const received = sentEmails.find((m) => m.to?.includes?.(`a@${TAG}.test`) || m.to === `a@${TAG}.test`);
      expect(received?.text || received?.html || JSON.stringify(received)).toMatch(/Booth power ×1/);
    });

    it('status view and admin detail expose the lines, editability and a pricing check that covers add-ons', async () => {
      const status = await request(app).get(`/applications/${appA.id}/status?token=${statusToken(appA.id)}`);
      expect(status.status).toBe(200);
      expect(status.body.addOns.map((l) => l.name)).toEqual(['Booth power', 'Extra vendor badge', 'Table & chairs']);
      expect(status.body.addOns[0]).toMatchObject({ addOnId: power.id, quantity: 1, unitPrice: 125 });

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

    it('ABSORB pay-at-submission form: Checkout itemises the tier and each add-on line to the snapshot total', async () => {
      const res = await submit(absorbForm.slug, gold.id, `absorb@${TAG}.test`, [{ addOnId: table.id, quantity: 2 }], 'Gold Sponsor Co');
      expect(res.status).toBe(201);
      const row = await appRow(res.body.applicationId);
      // ABSORB + taxable form at 10%: listed 1000 + 80, tax 108 → applicant pays 1188.
      expect(Number(row.subtotal)).toBe(1080);
      expect(Number(row.tax)).toBe(108);
      expect(Number(row.applicantPays)).toBe(1188);
      expect(row.addOns).toHaveLength(1);
      expect(Number(row.addOns[0].applicantPays)).toBe(88);
      const session = mockSessionsCreate.mock.calls.at(-1)[0];
      expect(session.mode).toBe('payment');
      expect(session.line_items).toHaveLength(2);
      expect(session.line_items.map((l) => l.price_data.product_data.name)).toEqual([`${TAG} Fair 2027 — Sponsors (Gold)`, 'Table & chairs ×2']);
      expect(session.line_items.reduce((s, l) => s + l.price_data.unit_amount * l.quantity, 0)).toBe(118800);
    });
  });

  // ─── Approval, capacity, edits ───────────────────────────────────────────

  describe('approval and line edits', () => {
    let appA; // 1 power, 2 badges, 1 table
    let appB; // wants 2 power
    let appC; // 1 power, card declines

    beforeAll(async () => {
      appA = await prisma.application.findFirst({ where: { organizationId: org.id, contact: { email: `a@${TAG}.test` } } });
      const b = await submit(form.slug, booth.id, `b@${TAG}.test`, [{ addOnId: power.id, quantity: 2 }], 'Two Plugs');
      appB = await cardOnFile(b.body.applicationId);
      const c = await submit(form.slug, booth.id, `c@${TAG}.test`, [{ addOnId: power.id, quantity: 1 }, { addOnId: badge.id, quantity: 1 }], 'Declined Inc');
      appC = await cardOnFile(c.body.applicationId);
    });

    it('approving charges the itemised snapshot and moves the add-ons to sold with the tier slot', async () => {
      const res = await decide(appA.id, 'APPROVE');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'APPROVED', paymentStatus: 'PAID', capacitySlot: 'APPROVED' });
      const intent = mockIntentsCreate.mock.calls.at(-1)[0];
      expect(intent.amount).toBe(Math.round(Number(res.body.amounts.applicantPays) * 100));
      expect(intent.description).toMatch(/Vendor Booth \(Booth\) \+ Booth power ×1, Extra vendor badge ×2, Table & chairs ×1/);
      expect(await addOnRow(power.id)).toMatchObject({ quantitySold: 1, quantityReserved: 0 });
      expect(await addOnRow(badge.id)).toMatchObject({ quantitySold: 2, quantityReserved: 0 });
      expect(await tierRow(booth.id)).toMatchObject({ quantityApproved: 1, quantityReserved: 0 });
      expect(res.body.addOnsEditable).toMatchObject({ allowed: false, reason: expect.stringMatching(/paid/i) });
    });

    it('a sold-out add-on returns 409 naming it and rolls the tier slot back', async () => {
      const res = await decide(appB.id, 'APPROVE');
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/Booth power is sold out: 2 requested, 1 left/);
      expect(res.body.details).toMatchObject({ addOnId: power.id, remaining: 1, requested: 2, suggestion: 'EDIT_ADD_ONS' });
      expect(mockIntentsCreate).not.toHaveBeenCalled();
      expect(await tierRow(booth.id)).toMatchObject({ quantityApproved: 1, quantityReserved: 0 });
      expect(await addOnRow(power.id)).toMatchObject({ quantitySold: 1, quantityReserved: 0 });
      const row = await appRow(appB.id);
      expect(row).toMatchObject({ status: 'SUBMITTED', paymentStatus: 'CARD_ON_FILE', capacitySlot: 'NONE', chargeAttempts: 0 });
    });

    it('ORGANIZER edits the lines before payment: snapshot recomputed, ADD_ONS_CHANGED recorded and emailed; no-ops and paid rows are refused', async () => {
      const before = await appRow(appB.id);
      const same = await patchAddOns(appB.id, [{ addOnId: power.id, quantity: 2 }]);
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
      expect(change.note).toBe(`Add-ons: Booth power ×2 → Booth power ×1, Table & chairs ×1. Total $${Number(before.applicantPays).toFixed(2)} → $${expected.applicantPays.toFixed(2)}.`);
      expect(change.emailSubject).toMatch(/application was updated/);
      const mail = sentEmails.at(-1);
      expect(JSON.stringify(mail)).toMatch(/Booth power ×1 \(\$/);
      expect(JSON.stringify(mail)).toContain(`$${expected.applicantPays.toFixed(2)}`);
      expect(mockSessionsExpire).not.toHaveBeenCalled();

      // Removing every line is a valid edit.
      const none = await patchAddOns(appB.id, []);
      expect(none.status).toBe(200);
      expect(none.body.addOns).toEqual([]);
      expect(none.body.amounts.orgReceives).toBe(275);
      // …and putting one back so the approval below sells it.
      const back = await patchAddOns(appB.id, [{ addOnId: power.id, quantity: 1 }], adminToken);
      expect(back.status).toBe(200);

      const approve = await decide(appB.id, 'APPROVE');
      expect(approve.status).toBe(200);
      expect(approve.body.paymentStatus).toBe('PAID');
      expect(await addOnRow(power.id)).toMatchObject({ quantitySold: 2, quantityReserved: 0 });
    });

    it('a declined card leaves add-ons reserved; editing lines in PAYMENT_DUE moves the hold and expires the pay-now session', async () => {
      // Free a power unit for C: withdraw B (sold → released).
      const withdraw = await decide(appB.id, 'WITHDRAW');
      expect(withdraw.status).toBe(200);
      expect(await addOnRow(power.id)).toMatchObject({ quantitySold: 1, quantityReserved: 0 });
      expect(await tierRow(booth.id)).toMatchObject({ quantityApproved: 1 });

      mockIntentsCreate.mockImplementationOnce(async () => {
        throw cardDecline();
      });
      const res = await decide(appC.id, 'APPROVE');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'APPROVED', paymentStatus: 'PAYMENT_DUE', capacitySlot: 'RESERVED' });
      expect(res.body.addOnsEditable.allowed).toBe(true);
      expect(await addOnRow(power.id)).toMatchObject({ quantitySold: 1, quantityReserved: 1 });
      expect(await addOnRow(badge.id)).toMatchObject({ quantitySold: 2, quantityReserved: 1 });
      expect(await tierRow(booth.id)).toMatchObject({ quantityApproved: 1, quantityReserved: 1 });

      // Applicant opens pay-now: a session is minted with the itemised lines.
      const pay = await request(app).post(`/applications/${appC.id}/pay?token=${statusToken(appC.id)}`);
      expect(pay.status).toBe(200);
      const payParams = mockSessionsCreate.mock.calls.at(-1)[0];
      expect(payParams.line_items.map((l) => l.price_data.product_data.name)).toEqual([`${TAG} Fair 2027 — Vendor Booth (Booth)`, 'Booth power ×1', 'Extra vendor badge ×1']);
      const sessionId = (await appRow(appC.id)).stripeCheckoutSessionId;
      expect(sessionId).toBeTruthy();

      // Organizer drops the badge and adds a table: holds follow, the stale session is expired.
      const edit = await patchAddOns(appC.id, [{ addOnId: power.id, quantity: 1 }, { addOnId: table.id, quantity: 1 }]);
      expect(edit.status).toBe(200);
      expect(edit.body).toMatchObject({ status: 'APPROVED', paymentStatus: 'PAYMENT_DUE', capacitySlot: 'RESERVED' });
      expect(await addOnRow(badge.id)).toMatchObject({ quantitySold: 2, quantityReserved: 0 });
      expect(await addOnRow(table.id)).toMatchObject({ quantityReserved: 1 });
      expect(await addOnRow(power.id)).toMatchObject({ quantitySold: 1, quantityReserved: 1 });
      expect(mockSessionsExpire).toHaveBeenCalledWith(sessionId);
      expect((await appRow(appC.id)).stripeCheckoutSessionId).toBeNull();

      // Asking for more power than is left is refused and leaves the holds as they were.
      const tooMany = await patchAddOns(appC.id, [{ addOnId: power.id, quantity: 2 }]);
      expect(tooMany.status).toBe(409);
      expect(await addOnRow(power.id)).toMatchObject({ quantitySold: 1, quantityReserved: 1 });
      expect((await appRow(appC.id)).addOns.map((l) => l.addOn.name)).toEqual(['Booth power', 'Table & chairs']);

      // Paying the new amount sells the held lines.
      const row = await appRow(appC.id);
      const paidSession = await webhook(
        checkoutCompleted({ id: 'cs_paynow_c', mode: 'payment', payment_status: 'paid', payment_intent: `pi_${TAG}_paynow_c`, metadata: { applicationId: appC.id, purpose: 'pay_now' } })
      );
      expect(paidSession.status).toBe(200);
      expect(await appRow(appC.id)).toMatchObject({ paymentStatus: 'PAID', capacitySlot: 'APPROVED' });
      expect(await addOnRow(power.id)).toMatchObject({ quantitySold: 2, quantityReserved: 0 });
      // appA's table plus this one
      expect(await addOnRow(table.id)).toMatchObject({ quantitySold: 2, quantityReserved: 0 });
      expect(Number(row.applicantPays)).toBe(Number((await appRow(appC.id)).applicantPays));
    });

    it('the overdue sweep releases held add-ons with the tier slot', async () => {
      const d = await submit(form.slug, corner.id, `d@${TAG}.test`, [{ addOnId: table.id, quantity: 3 }], 'Overdue LLC');
      const appD = await cardOnFile(d.body.applicationId);
      mockIntentsCreate.mockImplementationOnce(async () => {
        throw cardDecline();
      });
      const res = await decide(appD.id, 'APPROVE');
      expect(res.body).toMatchObject({ paymentStatus: 'PAYMENT_DUE', capacitySlot: 'RESERVED' });
      expect(await addOnRow(table.id)).toMatchObject({ quantitySold: 2, quantityReserved: 3 });
      expect(await tierRow(corner.id)).toMatchObject({ quantityReserved: 1 });

      const swept = await applicationPaymentService.sweepOverdue(new Date(Date.now() + 10 * 86_400_000));
      expect(swept.withdrawn).toBeGreaterThanOrEqual(1);
      expect(await appRow(appD.id)).toMatchObject({ status: 'WITHDRAWN', capacitySlot: 'NONE', withdrawnBy: 'SYSTEM' });
      expect(await addOnRow(table.id)).toMatchObject({ quantitySold: 2, quantityReserved: 0 });
      expect(await tierRow(corner.id)).toMatchObject({ quantityReserved: 0, quantityApproved: 0 });
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
      // Gold Sponsor Co never finished Checkout (DRAFT) so it is not listed.
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
      // Tables: A (1) + C (1) paid applications, 2 on the order; the withdrawn D and the DRAFT sponsor count nowhere.
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
      // Withdrawn applications still appear (with their status); DRAFTs do not.
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
