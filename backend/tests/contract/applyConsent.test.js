// Contract tests for spec 024 phase 3: the apply form's account and
// marketing opt-ins (applied once the application reaches SUBMITTED, never
// for an abandoned DRAFT), the LegalAcceptance trail on apply and checkout
// (versions, staleness, card authorization, hashed IP), the welcome sign-in
// link in the RECEIVED email, marketing provenance, and GET /legal/versions.
// Stripe and Resend mocked; Postgres is real.

import { jest } from '@jest/globals';
import request from 'supertest';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';
import { acceptances } from '../helpers/legal.js';

const sentEmails = [];
jest.unstable_mockModule('../../src/config/resend.js', () => ({
  default: {
    emails: {
      send: jest.fn(async (msg) => {
        sentEmails.push(msg);
        return { id: 'mock' };
      }),
    },
  },
}));

const mockSessionsCreate = jest.fn();
const mockCustomersCreate = jest.fn();
const mockSetupIntentsRetrieve = jest.fn();
jest.unstable_mockModule('../../src/config/stripe.js', () => ({
  default: {
    checkout: { sessions: { create: mockSessionsCreate, retrieve: jest.fn(), expire: jest.fn() } },
    customers: { create: mockCustomersCreate },
    paymentIntents: { create: jest.fn(), retrieve: jest.fn() },
    setupIntents: { retrieve: mockSetupIntentsRetrieve },
    refunds: { create: jest.fn() },
    webhooks: { constructEvent: jest.fn((body) => JSON.parse(body.toString())) },
  },
}));

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');
const { LEGAL_VERSIONS, cardAuthorizationText, applyConsentText } =
  await import('../../src/config/legal.js');
const { default: paymentSettingsService } =
  await import('../../src/services/PaymentSettingsService.js');

const TAG = 'consent';
const auth = (token) => ['Authorization', `Bearer ${token}`];

paymentSettingsService._statusCache = {
  value: {
    provider: 'STRIPE',
    mode: 'test',
    charges: 'active',
    statementDescriptorPrefix: 'JUMP',
    capabilities: {},
    manageUrl: '',
    radarUrl: '',
    error: null,
  },
  expiresAt: Number.POSITIVE_INFINITY,
};

let n = 0;
const webhook = (event) =>
  request(app)
    .post('/webhooks/stripe')
    .set('Content-Type', 'application/json')
    .send(JSON.stringify(event));

describe('Apply-form opt-ins and legal acceptances (spec 024 phase 3)', () => {
  let adminToken;
  let org;
  let eventId;
  let freeForm;
  let paidForm;
  let boothForm;
  let priceTier;
  const emails = [`admin@${TAG}.test`];

  const submit = (formSlug, tierId, email, extra = {}) =>
    request(app)
      .post(`/events/${eventId}/applications`)
      .set('User-Agent', 'ConsentTest/1.0 (jest)')
      .send({
        formSlug,
        tierId,
        contact: { email, firstName: 'Vee', lastName: 'Vendor' },
        profile: { businessName: `${email.split('@')[0]} Co` },
        answers: {},
        acceptances: acceptances(),
        ...extra,
      });
  const contactOf = (email) =>
    prisma.contact.findUnique({
      where: { organizationId_email: { organizationId: org.id, email } },
    });
  const acceptancesFor = async (referenceId) =>
    (await prisma.legalAcceptance.findMany({ where: { referenceId } })).sort((a, b) =>
      a.document.localeCompare(b.document)
    );

  beforeAll(async () => {
    process.env.APPLICATIONS_PAYMENTS_ENABLED = 'true';
    delete process.env.LEGAL_ACCEPTANCE_REQUIRED;
    await prisma.organization
      .deleteMany({ where: { name: { startsWith: `${TAG} ` } } })
      .catch(() => {});
    adminToken = await staffToken({ email: emails[0], role: 'ADMIN' });
    org = await prisma.organization.create({
      data: { name: `${TAG} Expo Co`, email: `owner@${TAG}.test` },
    });
    await joinOrgByToken(adminToken, org.id, 'ADMIN');
    const venue = await prisma.venue.create({
      data: {
        organizationId: org.id,
        name: `${TAG} Hall`,
        address: '1 Main',
        city: 'Raleigh',
        state: 'NC',
      },
    });
    const event = await prisma.event.create({
      data: {
        venueId: venue.id,
        name: `${TAG} Expo`,
        date: new Date('2027-09-18T15:00:00Z'),
        status: 'PUBLISHED',
        capacity: 500,
      },
    });
    eventId = event.id;
    priceTier = await prisma.priceTier.create({
      data: { eventId, name: 'GA', price: 20, quantityTotal: 100 },
    });
    const f = await request(app)
      .post(`/admin/events/${eventId}/application-forms`)
      .set(...auth(adminToken))
      .send({ kind: 'FREE', name: 'Press', questions: [] });
    freeForm = f.body;
    const p = await request(app)
      .post(`/admin/events/${eventId}/application-forms`)
      .set(...auth(adminToken))
      .send({
        kind: 'PAID',
        name: 'Vendors',
        chargeTiming: 'APPROVAL',
        paymentDueDays: 5,
        tiers: [{ name: '10x10', price: 250, quantityTotal: 10 }],
      });
    paidForm = p.body;
    // A booth form: same shape, but its tier is sold from a floor map, so
    // approval opens the picker instead of charging the saved card. Marked
    // map-bound directly — publishing a map is MapService's business, and
    // the flag is all the consent text reads.
    const b = await request(app)
      .post(`/admin/events/${eventId}/application-forms`)
      .set(...auth(adminToken))
      .send({
        kind: 'PAID',
        name: 'Booths',
        chargeTiming: 'APPROVAL',
        paymentDueDays: 7,
        tiers: [{ name: 'Corner 10x10', price: 400, quantityTotal: 10 }],
      });
    boothForm = b.body;
    await prisma.applicationTier.update({
      where: { id: boothForm.tiers[0].id },
      data: { mapBound: true },
    });
    for (const form of [freeForm, paidForm, boothForm]) {
      const opened = await request(app)
        .patch(`/admin/events/${eventId}/application-forms/${form.id}`)
        .set(...auth(adminToken))
        .send({ status: 'OPEN' });
      expect(opened.status).toBe(200);
    }
  });

  afterAll(async () => {
    delete process.env.APPLICATIONS_PAYMENTS_ENABLED;
    delete process.env.LEGAL_ACCEPTANCE_REQUIRED;
    await prisma.legalAcceptance.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.refund.deleteMany({ where: { order: { eventId } } }).catch(() => {});
    await prisma.paymentTransaction.deleteMany({ where: { order: { eventId } } }).catch(() => {});
    await prisma.order.deleteMany({ where: { eventId } }).catch(() => {});
    await prisma.application.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.applicantProfile.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.applicationForm.deleteMany({ where: { eventId } }).catch(() => {});
    await prisma.buyerLoginToken.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.priceTier.deleteMany({ where: { eventId } }).catch(() => {});
    await prisma.contact.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.event.deleteMany({ where: { id: eventId } }).catch(() => {});
    await prisma.venue.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.organization.deleteMany({ where: { id: org.id } }).catch(() => {});
    await cleanupStaff(emails);
    paymentSettingsService._invalidate();
  });

  beforeEach(() => {
    sentEmails.length = 0;
    mockSessionsCreate
      .mockReset()
      .mockImplementation(async (params) => ({
        id: `cs_${TAG}_${++n}`,
        url: `https://checkout.stripe.com/c/pay/cs_${TAG}_${n}`,
        mode: params.mode,
        metadata: params.metadata,
      }));
    mockCustomersCreate.mockReset().mockImplementation(async () => ({ id: `cus_${TAG}_${++n}` }));
    mockSetupIntentsRetrieve
      .mockReset()
      .mockImplementation(async (id) => ({ id, payment_method: `pm_${TAG}_${id}` }));
  });

  it('GET /legal/versions is public and returns the current versions', async () => {
    const res = await request(app).get('/legal/versions');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(LEGAL_VERSIONS);
    expect(res.headers['cache-control']).toMatch(/max-age=60/);
  });

  it('FREE form: opt-ins apply at submission with provenance, the RECEIVED email carries a one-time sign-in link, and the consent trail is written', async () => {
    const email = `free@${TAG}.test`;
    const res = await submit(freeForm.slug, undefined, email, {
      optInAccount: true,
      optInMarketing: true,
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ next: 'done', orderRef: null });

    const contact = await contactOf(email);
    expect(contact.accountCreatedAt).toBeTruthy();
    expect(contact).toMatchObject({
      emailSubscribed: true,
      emailSubscribedSource: 'APPLY',
      emailUnsubscribedAt: null,
    });
    expect(contact.emailSubscribedAt).toBeTruthy();
    const application = await prisma.application.findUnique({
      where: { id: res.body.applicationId },
    });
    expect(application).toMatchObject({ optInAccount: true, optInMarketing: true });
    expect(application.optInsAppliedAt).toBeTruthy();

    const tokens = await prisma.buyerLoginToken.findMany({
      where: { contactId: contact.id, purpose: 'WELCOME' },
    });
    expect(tokens).toHaveLength(1);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].subject).toMatch(/received your application/);
    expect(sentEmails[0].text).toContain(`Your account with ${org.name} is ready`);
    expect(sentEmails[0].text).toMatch(/\/account\/verify\?token=/);

    const rows = await acceptancesFor(res.body.applicationId);
    expect(rows.map((r) => r.document)).toEqual(['PRIVACY', 'TERMS']);
    for (const row of rows) {
      expect(row).toMatchObject({
        subjectType: 'CONTACT',
        subjectId: contact.id,
        email,
        organizationId: org.id,
        source: 'APPLY',
        referenceType: 'Application',
        userAgent: 'ConsentTest/1.0 (jest)',
      });
      expect(row.ipHash).toMatch(/^[a-f0-9]{64}$/);
      expect(row.ipHash).not.toMatch(/127\.0\.0\.1|::1/);
    }
    expect(rows.find((r) => r.document === 'PRIVACY').presentedText).toBe(
      applyConsentText({ organizationName: org.name })
    );
    expect(rows.find((r) => r.document === 'TERMS').version).toBe(LEGAL_VERSIONS.terms);
  });

  it('an existing account is untouched: no second welcome link, marketing stays as it was', async () => {
    const email = `free@${TAG}.test`;
    const before = await contactOf(email);
    await prisma.contact.update({
      where: { id: before.id },
      data: { emailSubscribed: false, emailUnsubscribedAt: new Date() },
    });
    await prisma.application.updateMany({
      where: { contactId: before.id },
      data: { status: 'WITHDRAWN' },
    });
    const res = await submit(freeForm.slug, undefined, email, {
      optInAccount: true,
      optInMarketing: false,
    });
    expect(res.status).toBe(201);
    const after = await contactOf(email);
    expect(after.accountCreatedAt.toISOString()).toBe(before.accountCreatedAt.toISOString());
    expect(after.emailSubscribed).toBe(false); // opt-ins only ever turn on; the applicant did not ask
    expect(
      await prisma.buyerLoginToken.count({ where: { contactId: before.id, purpose: 'WELCOME' } })
    ).toBe(1);
    expect(sentEmails[0].text).not.toContain('is ready');
  });

  it('stale or missing acceptances are refused before anything is written', async () => {
    const email = `stale@${TAG}.test`;
    const stale = await submit(freeForm.slug, undefined, email, {
      acceptances: [
        { document: 'TERMS', version: '2020-01-01' },
        { document: 'PRIVACY', version: LEGAL_VERSIONS.privacy },
      ],
    });
    expect(stale.status).toBe(400);
    expect(stale.body.code).toBe('LEGAL_VERSION_STALE');
    const missing = await submit(freeForm.slug, undefined, email, {
      acceptances: [{ document: 'TERMS', version: LEGAL_VERSIONS.terms }],
    });
    expect(missing.status).toBe(400);
    expect(missing.body.code).toBe('LEGAL_ACCEPTANCE_REQUIRED');
    expect(missing.body.message).toMatch(/privacy/);
    const none = await submit(freeForm.slug, undefined, email, { acceptances: undefined });
    expect(none.status).toBe(400);
    const unknown = await submit(freeForm.slug, undefined, email, {
      acceptances: [...acceptances(), { document: 'NDA', version: '1' }],
    });
    expect(unknown.status).toBe(400);
    expect(await contactOf(email)).toBeNull();
    expect(
      await prisma.application.count({ where: { organizationId: org.id, contact: { email } } })
    ).toBe(0);
    expect(await prisma.legalAcceptance.count({ where: { email } })).toBe(0);
  });

  it('PAID form charging at approval needs the card authorization; opt-ins wait for the card step and an abandoned DRAFT never applies them', async () => {
    const email = `paid@${TAG}.test`;
    const tier = paidForm.tiers[0];
    const noCard = await submit(paidForm.slug, tier.id, email, {
      optInAccount: true,
      optInMarketing: true,
    });
    expect(noCard.status).toBe(400);
    expect(noCard.body.code).toBe('LEGAL_ACCEPTANCE_REQUIRED');
    expect(noCard.body.message).toMatch(/card authorization/);

    const res = await submit(paidForm.slug, tier.id, email, {
      optInAccount: true,
      optInMarketing: true,
      acceptances: acceptances({ cardAuthorization: true }),
    });
    expect(res.status).toBe(201);
    expect(res.body.next).toBe('checkout');
    const draftId = res.body.applicationId;
    let contact = await contactOf(email);
    expect(contact.accountCreatedAt).toBeNull();
    expect(contact.emailSubscribed).toBe(false);
    const rows = await acceptancesFor(draftId);
    expect(rows.map((r) => r.document)).toEqual(['CARD_AUTHORIZATION', 'PRIVACY', 'TERMS']);
    const card = rows.find((r) => r.document === 'CARD_AUTHORIZATION');
    const order = await prisma.order.findUnique({ where: { applicationId: draftId } });
    expect(card.presentedText).toBe(
      cardAuthorizationText({
        amount: Number(order.totalAmount),
        paymentDueDays: 5,
        organizationName: org.name,
      })
    );
    expect(card.presentedText).toContain(`$${Number(order.totalAmount).toFixed(2)}`);
    expect(card.presentedText).toContain('only if my application is approved');
    expect(card.presentedText).toContain('5 days');
    // This tier is not map-bound, so the card really is charged at approval:
    // the booth variant must not be what was stored.
    expect(card.presentedText).toContain('I authorize');
    expect(card.presentedText).not.toContain('pick my booth');

    // Abandoned: a resubmission replaces the DRAFT; the first one's opt-ins never applied.
    const again = await submit(paidForm.slug, tier.id, email, {
      optInAccount: true,
      optInMarketing: true,
      acceptances: acceptances({ cardAuthorization: true }),
    });
    expect(again.status).toBe(201);
    expect(
      (await prisma.application.findUnique({ where: { id: draftId } })).optInsAppliedAt
    ).toBeNull();
    contact = await contactOf(email);
    expect(contact.accountCreatedAt).toBeNull();

    // Card saved → SUBMITTED → opt-ins apply, RECEIVED carries the sign-in link.
    sentEmails.length = 0;
    const row = await prisma.application.findUnique({
      where: { id: again.body.applicationId },
      include: { contact: true },
    });
    const hook = await webhook({
      id: `evt_${TAG}_setup`,
      type: 'checkout.session.completed',
      data: {
        object: {
          id: row.stripeCheckoutSessionId,
          mode: 'setup',
          setup_intent: `seti_${row.id}`,
          customer: row.contact.stripeCustomerId,
          metadata: { applicationId: row.id, purpose: 'submit' },
        },
      },
    });
    expect(hook.status).toBe(200);
    const submitted = await prisma.application.findUnique({ where: { id: row.id } });
    expect(submitted).toMatchObject({ status: 'SUBMITTED', paymentStatus: 'CARD_ON_FILE' });
    expect(submitted.optInsAppliedAt).toBeTruthy();
    contact = await contactOf(email);
    expect(contact.accountCreatedAt).toBeTruthy();
    expect(contact).toMatchObject({ emailSubscribed: true, emailSubscribedSource: 'APPLY' });
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].subject).toMatch(/received your application/);
    expect(sentEmails[0].text).toContain('is ready');
    expect(sentEmails[0].text).toMatch(/\/account\/verify\?token=/);
    // Replaying the webhook applies nothing twice.
    await webhook({
      id: `evt_${TAG}_setup2`,
      type: 'checkout.session.completed',
      data: {
        object: {
          id: row.stripeCheckoutSessionId,
          mode: 'setup',
          setup_intent: `seti_${row.id}`,
          customer: row.contact.stripeCustomerId,
          metadata: { applicationId: row.id, purpose: 'submit' },
        },
      },
    });
    expect(
      await prisma.buyerLoginToken.count({ where: { contactId: contact.id, purpose: 'WELCOME' } })
    ).toBe(1);
  });

  // A map-bound tier is forced to chargeTiming APPROVAL, and APPROVAL is what
  // makes CARD_AUTHORIZATION mandatory — so every booth applicant accepts
  // this text. Approval does not charge their card: it sets PAYMENT_DUE and
  // the money moves when they come back and hold a booth. The stored
  // `presentedText` has to say that, because it is the consent record for the
  // one flow that takes real money.
  it('a booth applicant is shown and has recorded the map-bound authorization, and the public form says which variant to show', async () => {
    const email = `booth@${TAG}.test`;
    const tier = boothForm.tiers[0];

    // What the apply form reads to pick the variant it renders.
    const published = await request(app).get(
      `/events/${eventId}/applications/forms/${boothForm.slug}`
    );
    expect(published.status).toBe(200);
    expect(published.body.tiers.find((t) => t.id === tier.id).mapBound).toBe(true);
    const notBooth = await request(app).get(
      `/events/${eventId}/applications/forms/${paidForm.slug}`
    );
    expect(notBooth.body.tiers.every((t) => t.mapBound === false)).toBe(true);

    const res = await submit(boothForm.slug, tier.id, email, {
      acceptances: acceptances({ cardAuthorization: true }),
    });
    expect(res.status).toBe(201);
    const rows = await acceptancesFor(res.body.applicationId);
    const card = rows.find((r) => r.document === 'CARD_AUTHORIZATION');
    const order = await prisma.order.findUnique({
      where: { applicationId: res.body.applicationId },
    });

    // Byte-for-byte the booth variant, rendered server-side from the same
    // inputs the client used — never the client's own string.
    expect(card.presentedText).toBe(
      cardAuthorizationText({
        amount: Number(order.totalAmount),
        paymentDueDays: 7,
        organizationName: org.name,
        mapBound: true,
      })
    );
    expect(card.presentedText).toContain('I come back to pick my booth and pay');
    expect(card.presentedText).toContain(`$${Number(order.totalAmount).toFixed(2)}`);
    expect(card.presentedText).toContain('7 days');
    // The sentence this correction replaces, which described a charge the
    // map-bound path never makes.
    expect(card.presentedText).not.toContain('I authorize');
    expect(card.presentedText).not.toContain('If the charge fails');
    // The trail can tell a new acceptance from an old one.
    expect(card.version).toBe(LEGAL_VERSIONS.cardAuthorization);
    expect(LEGAL_VERSIONS.cardAuthorization).not.toBe('2026-09-19-draft');
  });

  it('checkout records TERMS + PRIVACY on the order; missing acceptances are logged until the legal pages go live, then refused; stale is always refused', async () => {
    const body = {
      eventId,
      items: [{ priceTierId: priceTier.id, quantity: 1 }],
      contact: { email: `buyer@${TAG}.test`, firstName: 'Bea', lastName: 'Buyer' },
    };
    const withRows = await request(app)
      .post('/orders')
      .set('User-Agent', 'ConsentTest/1.0 (jest)')
      .send({ ...body, acceptances: acceptances() });
    expect(withRows.status).toBe(201);
    const rows = (
      await prisma.legalAcceptance.findMany({
        where: { referenceType: 'Order', referenceId: withRows.body.orderId },
      })
    ).sort((a, b) => a.document.localeCompare(b.document));
    expect(rows.map((r) => r.document)).toEqual(['PRIVACY', 'TERMS']);
    expect(rows[0]).toMatchObject({
      subjectType: 'CONTACT',
      email: `buyer@${TAG}.test`,
      organizationId: org.id,
      source: 'CHECKOUT',
      userAgent: 'ConsentTest/1.0 (jest)',
    });
    expect(rows[0].subjectId).toBeTruthy();
    expect(rows[0].ipHash).toMatch(/^[a-f0-9]{64}$/);

    const without = await request(app).post('/orders').send(body);
    expect(without.status).toBe(201);
    expect(
      await prisma.legalAcceptance.count({ where: { referenceId: without.body.orderId } })
    ).toBe(0);

    const stale = await request(app)
      .post('/orders')
      .send({
        ...body,
        acceptances: [
          { document: 'TERMS', version: 'old' },
          { document: 'PRIVACY', version: LEGAL_VERSIONS.privacy },
        ],
      });
    expect(stale.status).toBe(400);
    expect(stale.body.code).toBe('LEGAL_VERSION_STALE');

    process.env.LEGAL_ACCEPTANCE_REQUIRED = 'true';
    try {
      const refused = await request(app).post('/orders').send(body);
      expect(refused.status).toBe(400);
      expect(refused.body.code).toBe('LEGAL_ACCEPTANCE_REQUIRED');
      // Nothing reserved for a refused checkout
      const tier = await prisma.priceTier.findUnique({ where: { id: priceTier.id } });
      expect(tier.quantityReserved).toBe(2);
    } finally {
      delete process.env.LEGAL_ACCEPTANCE_REQUIRED;
    }
  });

  it('staff edits of the marketing flag carry ADMIN provenance and an unsubscribe stamp', async () => {
    const contact = await contactOf(`free@${TAG}.test`);
    const on = await request(app)
      .patch(`/admin/customers/${contact.id}`)
      .set(...auth(adminToken))
      .send({ emailSubscribed: true });
    expect(on.status).toBe(200);
    let row = await prisma.contact.findUnique({ where: { id: contact.id } });
    expect(row).toMatchObject({
      emailSubscribed: true,
      emailSubscribedSource: 'ADMIN',
      emailUnsubscribedAt: null,
    });
    const off = await request(app)
      .patch(`/admin/customers/${contact.id}`)
      .set(...auth(adminToken))
      .send({ emailSubscribed: false });
    expect(off.status).toBe(200);
    row = await prisma.contact.findUnique({ where: { id: contact.id } });
    expect(row.emailSubscribed).toBe(false);
    expect(row.emailUnsubscribedAt).toBeTruthy();
    expect(row.emailSubscribedSource).toBe('ADMIN');
  });
});
