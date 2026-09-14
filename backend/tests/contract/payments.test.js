// Contract tests for Settings › Payments (spec 010 phase 1)
// Org scoping via memberships / X-Jump-Org / ?organizationId=, RBAC on writes,
// validator errors, role masking of dashboard links, and the checkout options
// Stripe receives after an organization changes its settings.

import { jest } from '@jest/globals';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');
const { default: paymentSettingsService } = await import('../../src/services/PaymentSettingsService.js');

const AUTH_SECRET = process.env.AUTH_SECRET;
const TAG = 'pay-ct';

function tokenFor(user) {
  return jwt.sign({ sub: user.id, email: user.email, role: user.role, name: 'Pay Test' }, AUTH_SECRET, {
    algorithm: 'HS256',
    expiresIn: '1h',
  });
}

// No live Stripe in tests: pin the platform account status.
const providerStatus = {
  provider: 'STRIPE',
  mode: 'test',
  charges: 'active',
  statementDescriptorPrefix: 'JUMP',
  capabilities: { link: 'active', cashapp: 'active', affirm: 'inactive', klarna: null, afterpay_clearpay: null },
  manageUrl: 'https://dashboard.stripe.com/test/',
  radarUrl: 'https://dashboard.stripe.com/test/radar/rules',
  error: null,
};
paymentSettingsService._statusCache = { value: providerStatus, expiresAt: Number.POSITIVE_INFINITY };

describe('Settings › Payments contract (spec 010)', () => {
  let orgA;
  let orgB;
  let adminA;
  let organizerA;
  let adminB;
  let sysAdmin;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: `@${TAG}.test` } } }).catch(() => {});
    await prisma.organization.deleteMany({ where: { name: { startsWith: `${TAG} ` } } }).catch(() => {});
    orgA = await prisma.organization.create({ data: { name: `${TAG} Roman Skin Care` } });
    orgB = await prisma.organization.create({ data: { name: `${TAG} Other Org`, statementDescriptorSuffix: 'OTHER ORG' } });
    [adminA, organizerA, adminB, sysAdmin] = await Promise.all([
      prisma.user.create({ data: { email: `admin-a@${TAG}.test`, role: 'ADMIN', memberships: { create: { organizationId: orgA.id, role: 'ADMIN' } } } }),
      prisma.user.create({ data: { email: `org-a@${TAG}.test`, role: 'ORGANIZER', memberships: { create: { organizationId: orgA.id, role: 'ORGANIZER' } } } }),
      prisma.user.create({ data: { email: `admin-b@${TAG}.test`, role: 'ADMIN', memberships: { create: { organizationId: orgB.id, role: 'ADMIN' } } } }),
      prisma.user.create({ data: { email: `sys@${TAG}.test`, role: 'SYSTEM_ADMIN' } }),
    ]);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: `@${TAG}.test` } } }).catch(() => {});
    await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } }).catch(() => {});
    paymentSettingsService._invalidate();
  });

  it('GET /admin/settings/payments returns provider status, derived descriptor and method rows', async () => {
    const res = await request(app).get('/admin/settings/payments').set('Authorization', `Bearer ${tokenFor(adminA)}`);
    expect(res.status).toBe(200);
    expect(res.body.provider).toMatchObject({ provider: 'STRIPE', mode: 'test', charges: 'active', statementDescriptorPrefix: 'JUMP' });
    expect(res.body.provider.manageUrl).toBeUndefined();
    expect(res.body.provider.radarUrl).toBeUndefined();
    expect(res.body.canEdit).toBe(true);
    expect(res.body.settings.statementDescriptorSuffix).toBeNull();
    // "PAY CT ROMAN SKIN CARE" cut to the 16-character budget
    expect(res.body.settings.descriptor).toMatchObject({ prefix: 'JUMP', suffix: 'PAY CT ROMAN SKI', full: 'JUMP* PAY CT ROMAN SKI', derived: true, budget: 16 });
    expect(res.body.settings.methods.cards).toContain('visa');
    expect(res.body.settings.methods.wallets).toEqual(['apple_pay', 'google_pay']);
    const link = res.body.settings.methods.optional.find((m) => m.type === 'link');
    expect(link).toMatchObject({ label: 'Link', available: true, enabled: false });
    expect(res.body.settings.rates).toEqual({ platformFeePercent: 0.05, processingFeePercent: 0.029, processingFeeFixed: 0.3 });
  });

  it('SYSTEM_ADMIN sees the dashboard links and can target an org with ?organizationId=', async () => {
    const res = await request(app)
      .get(`/admin/settings/payments?organizationId=${orgB.id}`)
      .set('Authorization', `Bearer ${tokenFor(sysAdmin)}`);
    expect(res.status).toBe(200);
    expect(res.body.provider.manageUrl).toBe('https://dashboard.stripe.com/test/');
    expect(res.body.provider.radarUrl).toContain('radar');
    expect(res.body.settings.descriptor.full).toBe('JUMP* OTHER ORG');
  });

  it('ORGANIZER can read but not edit', async () => {
    const read = await request(app).get('/admin/settings/payments').set('Authorization', `Bearer ${tokenFor(organizerA)}`);
    expect(read.status).toBe(200);
    expect(read.body.canEdit).toBe(false);

    const write = await request(app)
      .patch('/admin/settings/payments')
      .set('Authorization', `Bearer ${tokenFor(organizerA)}`)
      .send({ statementDescriptorSuffix: 'ROMAN' });
    expect(write.status).toBe(403);
  });

  it('PATCH validates the body', async () => {
    const auth = ['Authorization', `Bearer ${tokenFor(adminA)}`];
    const cases = [
      [{}, /Provide statementDescriptorSuffix/],
      [{ bogus: 1 }, /Unknown field/],
      [{ statementDescriptorSuffix: 42 }, /string or null/],
      [{ enabledPaymentMethods: 'link' }, /must be an array/],
      [{ statementDescriptorSuffix: 'ROMAN*SKIN' }, /letters, numbers and spaces/],
      [{ statementDescriptorSuffix: '2026' }, /at least one letter/],
      [{ statementDescriptorSuffix: 'ROMAN SKIN AND BODY CO' }, /16 characters or fewer/],
      [{ enabledPaymentMethods: ['us_bank_account'] }, /Unknown payment method/],
      [{ enabledPaymentMethods: ['affirm'] }, /not available/],
    ];
    for (const [body, message] of cases) {
      const res = await request(app).patch('/admin/settings/payments').set(...auth).send(body);
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(message);
    }
  });

  it('PATCH saves the suffix and methods, and Checkout receives them', async () => {
    const auth = ['Authorization', `Bearer ${tokenFor(adminA)}`];
    const saved = await request(app)
      .patch('/admin/settings/payments')
      .set(...auth)
      .send({ statementDescriptorSuffix: 'roman skin', enabledPaymentMethods: ['cashapp', 'link'] });
    expect(saved.status).toBe(200);
    expect(saved.body.statementDescriptorSuffix).toBe('ROMAN SKIN');
    expect(saved.body.descriptor).toMatchObject({ full: 'JUMP* ROMAN SKIN', derived: false });
    expect(saved.body.enabledPaymentMethods).toEqual(['link', 'cashapp']);
    expect(saved.body.updatedAt).toEqual(expect.any(String));

    const organization = await prisma.organization.findUnique({ where: { id: orgA.id } });
    expect(await paymentSettingsService.checkoutOptionsFor(organization)).toEqual({
      payment_method_types: ['card', 'link', 'cashapp'],
      payment_intent_data: { statement_descriptor_suffix: 'ROMAN SKIN' },
    });

    // Clearing the suffix returns to the derived name
    const cleared = await request(app).patch('/admin/settings/payments').set(...auth).send({ statementDescriptorSuffix: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.descriptor).toMatchObject({ suffix: 'PAY CT ROMAN SKI', derived: true });
  });

  it('members are scoped to their own organization even with a foreign X-Jump-Org', async () => {
    const res = await request(app)
      .get('/admin/settings/payments')
      .set('Authorization', `Bearer ${tokenFor(adminB)}`)
      .set('X-Jump-Org', orgA.id);
    expect(res.status).toBe(200);
    expect(res.body.settings.descriptor.full).toBe('JUMP* OTHER ORG');

    const write = await request(app)
      .patch('/admin/settings/payments')
      .set('Authorization', `Bearer ${tokenFor(adminB)}`)
      .set('X-Jump-Org', orgA.id)
      .send({ statementDescriptorSuffix: 'HIJACK' });
    expect(write.status).toBe(200);
    const a = await prisma.organization.findUnique({ where: { id: orgA.id }, select: { statementDescriptorSuffix: true } });
    const b = await prisma.organization.findUnique({ where: { id: orgB.id }, select: { statementDescriptorSuffix: true } });
    expect(a.statementDescriptorSuffix).toBeNull();
    expect(b.statementDescriptorSuffix).toBe('HIJACK');
  });

  it('unauthenticated requests are rejected', async () => {
    const res = await request(app).get('/admin/settings/payments');
    expect(res.status).toBe(401);
  });
});
