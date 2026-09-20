// Contract tests for one-time code sign-in (spec 031 phase 3):
// CODE organizations get a code in the email, POST /buyer/auth/verify-code
// exchanges it once, wrong guesses lock it, LINK organizations get no code,
// and the setting round-trips through Settings › Customer accounts.

import { jest } from '@jest/globals';
import request from 'supertest';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';

const sentEmails = [];
jest.unstable_mockModule('../../src/config/resend.js', () => ({
  default: { emails: { send: jest.fn(async (msg) => { sentEmails.push(msg); return { id: 'mock' }; }) } },
}));

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');
const { default: buyerAuthService, CODE_MAX_ATTEMPTS } = await import('../../src/services/BuyerAuthService.js');

const TAG = 'signin-code-ct';
const EMAIL = `buyer@${TAG}.test`;
const staffEmails = [`admin@${TAG}.test`];

const flush = () => new Promise((resolve) => setTimeout(resolve, 20));
const wrongCode = (code) => String((Number(code) + 1) % 1e6).padStart(6, '0');

describe('Buyer sign-in code', () => {
  let org;
  let contact;
  let adminToken;

  beforeAll(async () => {
    await prisma.organization.deleteMany({ where: { name: { startsWith: `${TAG} ` } } }).catch(() => {});
    org = await prisma.organization.create({ data: { name: `${TAG} Org`, buyerSignInMethod: 'CODE' } });
    contact = await prisma.contact.create({ data: { organizationId: org.id, email: EMAIL, firstName: 'C', lastName: 'C', accountCreatedAt: new Date() } });
    adminToken = await staffToken({ email: staffEmails[0], role: 'ADMIN' });
    await joinOrgByToken(adminToken, org.id, 'ADMIN');
  });

  afterAll(async () => {
    await prisma.buyerLoginToken.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.contact.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.organization.delete({ where: { id: org.id } }).catch(() => {});
    await cleanupStaff(staffEmails);
  });

  beforeEach(() => {
    sentEmails.length = 0;
  });

  async function requestCode() {
    const res = await request(app).post('/buyer/auth/request').send({ organizationId: org.id, email: EMAIL });
    expect(res.status).toBe(202);
    await flush();
    const email = sentEmails.at(-1);
    const code = email.subject.match(/^(\d{6}) is your sign-in code/)?.[1];
    return { email, code };
  }

  it('emails a six-digit code plus the link, and the code signs the buyer in once', async () => {
    const { email, code } = await requestCode();
    expect(code).toMatch(/^\d{6}$/);
    expect(email.html).toContain(`${code.slice(0, 3)} ${code.slice(3)}`);
    expect(email.html).toContain('/account/verify?token=');

    const bad = await request(app).post('/buyer/auth/verify-code').send({ organizationId: org.id, email: EMAIL, code: wrongCode(code) });
    expect(bad.status).toBe(401);

    const ok = await request(app).post('/buyer/auth/verify-code').send({ organizationId: org.id, email: ' Buyer@SIGNIN-CODE-CT.test ' .trim(), code });
    expect(ok.status).toBe(200);
    expect(ok.body.organizationId).toBe(org.id);
    const session = buyerAuthService.verifySession(ok.body.sessionToken);
    expect(session.contactId).toBe(contact.id);

    const again = await request(app).post('/buyer/auth/verify-code').send({ organizationId: org.id, email: EMAIL, code });
    expect(again.status).toBe(401);
  });

  it('locks the code after repeated wrong guesses, even if the right one follows', async () => {
    const { code } = await requestCode();
    for (let i = 0; i < CODE_MAX_ATTEMPTS; i++) {
      const res = await request(app).post('/buyer/auth/verify-code').send({ organizationId: org.id, email: EMAIL, code: wrongCode(code) });
      expect(res.status).toBe(401);
    }
    const locked = await request(app).post('/buyer/auth/verify-code').send({ organizationId: org.id, email: EMAIL, code });
    expect(locked.status).toBe(401);
    const row = await prisma.buyerLoginToken.findFirst({ where: { contactId: contact.id, purpose: 'CODE' }, orderBy: { createdAt: 'desc' } });
    expect(row.attempts).toBe(CODE_MAX_ATTEMPTS);
    expect(row.usedAt).not.toBeNull();
  });

  it('a code is bound to its address and organization; malformed input is 401', async () => {
    const other = await prisma.organization.create({ data: { name: `${TAG} Other`, buyerSignInMethod: 'CODE' } });
    try {
      const { code } = await requestCode();
      expect((await request(app).post('/buyer/auth/verify-code').send({ organizationId: other.id, email: EMAIL, code })).status).toBe(401);
      expect((await request(app).post('/buyer/auth/verify-code').send({ organizationId: org.id, email: `x${EMAIL}`, code })).status).toBe(401);
      expect((await request(app).post('/buyer/auth/verify-code').send({ organizationId: org.id, email: EMAIL, code: '12345' })).status).toBe(401);
      expect((await request(app).post('/buyer/auth/verify-code').send({ organizationId: org.id, email: EMAIL, code: 123456 })).status).toBe(401);
      expect((await request(app).post('/buyer/auth/verify-code').send({})).status).toBe(401);
      expect((await request(app).post('/buyer/auth/verify-code').send({ organizationId: org.id, email: EMAIL, code })).status).toBe(200);
    } finally {
      await prisma.organization.delete({ where: { id: other.id } }).catch(() => {});
    }
  });

  it('LINK organizations get the plain link email and no usable code', async () => {
    // The three requests above used up the per-email LOGIN cap (3 / 15 min).
    await prisma.buyerLoginToken.deleteMany({ where: { contactId: contact.id } });
    await request(app).patch('/admin/settings/customer-accounts').set('Authorization', `Bearer ${adminToken}`).send({ buyerSignInMethod: 'LINK' });
    const res = await request(app).post('/buyer/auth/request').send({ organizationId: org.id, email: EMAIL });
    expect(res.status).toBe(202);
    await flush();
    const email = sentEmails.at(-1);
    expect(email.subject).toBe(`Your sign-in link for ${org.name}`);
    expect(email.html).not.toContain('Enter this code');
    const codes = await prisma.buyerLoginToken.count({ where: { contactId: contact.id, purpose: 'CODE', usedAt: null, expiresAt: { gt: new Date() } } });
    expect(codes).toBe(0);
  });

  it('the setting validates and shows in the settings and public payloads', async () => {
    const bad = await request(app).patch('/admin/settings/customer-accounts').set('Authorization', `Bearer ${adminToken}`).send({ buyerSignInMethod: 'SMS' });
    expect(bad.status).toBe(400);
    const saved = await request(app).patch('/admin/settings/customer-accounts').set('Authorization', `Bearer ${adminToken}`).send({ buyerSignInMethod: 'CODE' });
    expect(saved.status).toBe(200);
    expect(saved.body.signInMethod).toBe('CODE');
    const pub = await request(app).get(`/organizations/${org.id}/public`);
    expect(pub.body.organization.buyerSignInMethod).toBe('CODE');
  });
});
