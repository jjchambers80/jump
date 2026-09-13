// Contract tests for storefront custom domains (spec 007 phase 3)
// Admin CRUD + verify, org isolation, public host resolution, CORS for active
// hosts, and per-org storefront URLs in emails / Stripe redirects.

import { jest } from '@jest/globals';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');
const { default: domainService } = await import('../../src/services/DomainService.js');
const storefront = await import('../../src/utils/storefrontUrl.js');

const AUTH_SECRET = process.env.AUTH_SECRET;
const TAG = 'domains-ct';

function tokenFor(user) {
  return jwt.sign({ sub: user.id, email: user.email, role: user.role, name: 'Dom Test' }, AUTH_SECRET, {
    algorithm: 'HS256',
    expiresIn: '1h',
  });
}

// DNS stub: answers by hostname, configurable per test
const dnsAnswers = { txt: {}, cname: {} };
const nx = (n) => Object.assign(new Error(`ENOTFOUND ${n}`), { code: 'ENOTFOUND' });
domainService._dns = {
  resolveTxt: async (name) => (name in dnsAnswers.txt ? dnsAnswers.txt[name] : Promise.reject(nx(name))),
  resolveCname: async (name) => (name in dnsAnswers.cname ? dnsAnswers.cname[name] : Promise.reject(nx(name))),
};

describe('Storefront domains contract (spec 007 phase 3)', () => {
  let orgA;
  let orgB;
  let adminA;
  let adminB;
  let sysAdmin;
  const host = `tickets.${TAG}.example`;

  beforeAll(async () => {
    orgA = await prisma.organization.create({ data: { name: `${TAG} A` } });
    orgB = await prisma.organization.create({ data: { name: `${TAG} B` } });
    [adminA, adminB, sysAdmin] = await Promise.all([
      prisma.user.create({ data: { email: `a@${TAG}.test`, role: 'ADMIN', memberships: { create: { organizationId: orgA.id, role: 'ADMIN' } } } }),
      prisma.user.create({ data: { email: `b@${TAG}.test`, role: 'ADMIN', memberships: { create: { organizationId: orgB.id, role: 'ADMIN' } } } }),
      prisma.user.create({ data: { email: `sys@${TAG}.test`, role: 'SYSTEM_ADMIN' } }),
    ]);
  });

  afterAll(async () => {
    await prisma.organizationDomain.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { email: { endsWith: `@${TAG}.test` } } }).catch(() => {});
    await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } }).catch(() => {});
    domainService._invalidate();
  });

  let domain;

  it('POST /admin/settings/domains registers a hostname and returns DNS instructions', async () => {
    const res = await request(app)
      .post('/admin/settings/domains')
      .set('Authorization', `Bearer ${tokenFor(adminA)}`)
      .send({ hostname: `https://${host.toUpperCase()}/` });
    expect(res.status).toBe(201);
    domain = res.body;
    expect(domain.hostname).toBe(host);
    expect(domain.status).toBe('PENDING');
    expect(domain.isPrimary).toBe(true);
    expect(domain.dnsRecords.map((r) => r.type)).toEqual(['CNAME', 'TXT']);
    expect(domain.dnsRecords[1].name).toBe(`_jump-verify.${host}`);
    expect(domain.dnsRecords[1].value).toMatch(/^jump-verify=[0-9a-f]{32}$/);
  });

  it('rejects invalid, apex, platform, and duplicate hostnames', async () => {
    const post = (hostname) =>
      request(app).post('/admin/settings/domains').set('Authorization', `Bearer ${tokenFor(adminA)}`).send({ hostname });
    expect((await post('not valid')).status).toBe(400);
    expect((await post('example.com')).status).toBe(400);
    expect((await post('x.up.railway.app')).status).toBe(400);
    expect((await post(host)).status).toBe(409);
    expect((await post(host)).status).toBe(409); // also from org B
  });

  it('GET lists only the caller organization domains', async () => {
    const a = await request(app).get('/admin/settings/domains').set('Authorization', `Bearer ${tokenFor(adminA)}`);
    const b = await request(app).get('/admin/settings/domains').set('Authorization', `Bearer ${tokenFor(adminB)}`);
    expect(a.status).toBe(200);
    expect(a.body.domains.map((d) => d.id)).toEqual([domain.id]);
    expect(b.body.domains).toEqual([]);
  });

  it('org B cannot verify, promote, or delete org A domain', async () => {
    const t = tokenFor(adminB);
    expect((await request(app).post(`/admin/settings/domains/${domain.id}/verify`).set('Authorization', `Bearer ${t}`)).status).toBe(404);
    expect((await request(app).post(`/admin/settings/domains/${domain.id}/primary`).set('Authorization', `Bearer ${t}`)).status).toBe(404);
    expect((await request(app).delete(`/admin/settings/domains/${domain.id}`).set('Authorization', `Bearer ${t}`)).status).toBe(404);
  });

  it('SYSTEM_ADMIN manages domains by ?organizationId', async () => {
    const res = await request(app)
      .get('/admin/settings/domains')
      .query({ organizationId: orgA.id })
      .set('Authorization', `Bearer ${tokenFor(sysAdmin)}`);
    expect(res.status).toBe(200);
    expect(res.body.domains).toHaveLength(1);
    expect((await request(app).get('/admin/settings/domains').set('Authorization', `Bearer ${tokenFor(sysAdmin)}`)).status).toBe(404);
  });

  it('verify stays PENDING with an explanation until DNS is right', async () => {
    const res = await request(app).post(`/admin/settings/domains/${domain.id}/verify`).set('Authorization', `Bearer ${tokenFor(adminA)}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('PENDING');
    expect(res.body.lastError).toMatch(/TXT/);
    expect(res.body.lastCheckedAt).toBeTruthy();

    // unresolved hosts do not resolve publicly
    expect((await request(app).get('/domains/resolve').query({ host })).status).toBe(404);
    expect(await storefront.storefrontFor(orgA.id)).toMatchObject({ custom: false });
  });

  it('verify activates once TXT + CNAME resolve; host resolves, CORS allows it, URLs switch', async () => {
    const token = domain.dnsRecords[1].value;
    dnsAnswers.txt[`_jump-verify.${host}`] = [[token]];
    dnsAnswers.cname[host] = [domain.dnsRecords[0].value];

    const res = await request(app).post(`/admin/settings/domains/${domain.id}/verify`).set('Authorization', `Bearer ${tokenFor(adminA)}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ACTIVE');
    expect(res.body.verifiedAt).toBeTruthy();

    const resolve = await request(app).get('/domains/resolve').query({ host: host.toUpperCase() });
    expect(resolve.status).toBe(200);
    expect(resolve.body).toEqual({ organizationId: orgA.id });

    const cors = await request(app).options('/events').set('Origin', `https://${host}`).set('Access-Control-Request-Method', 'GET');
    expect(cors.headers['access-control-allow-origin']).toBe(`https://${host}`);
    const corsBad = await request(app).options('/events').set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'GET');
    expect(corsBad.headers['access-control-allow-origin']).toBeUndefined();

    expect(await storefront.storefrontFor(orgA.id)).toEqual({ base: `https://${host}`, custom: true });
    expect(await storefront.buyerAccountUrl(orgA.id)).toBe(`https://${host}/account`);
    expect(await storefront.orgPageUrl(orgA.id)).toBe(`https://${host}/`);
    expect(await storefront.orderUrl('o1', orgA.id)).toBe(`https://${host}/orders/o1`);
    // org B has no domain: platform URLs
    expect(await storefront.buyerAccountUrl(orgB.id)).toMatch(new RegExp(`/organizations/${orgB.id}/account$`));
  });

  it('a second domain is not primary; primary can be switched; deleting primary promotes the other', async () => {
    const t = tokenFor(adminA);
    const second = await request(app).post('/admin/settings/domains').set('Authorization', `Bearer ${t}`).send({ hostname: `shop.${TAG}.example` });
    expect(second.status).toBe(201);
    expect(second.body.isPrimary).toBe(false);

    const promoted = await request(app).post(`/admin/settings/domains/${second.body.id}/primary`).set('Authorization', `Bearer ${t}`);
    expect(promoted.body.isPrimary).toBe(true);
    const list = await request(app).get('/admin/settings/domains').set('Authorization', `Bearer ${t}`);
    expect(list.body.domains.filter((d) => d.isPrimary).map((d) => d.id)).toEqual([second.body.id]);

    // primary but not ACTIVE: storefront URLs still use the ACTIVE host
    expect(await storefront.storefrontFor(orgA.id)).toEqual({ base: `https://${host}`, custom: true });

    expect((await request(app).delete(`/admin/settings/domains/${second.body.id}`).set('Authorization', `Bearer ${t}`)).status).toBe(204);
    const after = await request(app).get('/admin/settings/domains').set('Authorization', `Bearer ${t}`);
    expect(after.body.domains).toHaveLength(1);
    expect(after.body.domains[0].isPrimary).toBe(true);
  });

  it('a lost record keeps the domain ACTIVE inside the grace period and records the error', async () => {
    delete dnsAnswers.txt[`_jump-verify.${host}`];
    const res = await request(app).post(`/admin/settings/domains/${domain.id}/verify`).set('Authorization', `Bearer ${tokenFor(adminA)}`);
    expect(res.body.status).toBe('ACTIVE');
    expect(res.body.lastError).toMatch(/TXT/);
  });

  it('DELETE removes the domain and the host stops resolving', async () => {
    expect((await request(app).delete(`/admin/settings/domains/${domain.id}`).set('Authorization', `Bearer ${tokenFor(adminA)}`)).status).toBe(204);
    expect((await request(app).get('/domains/resolve').query({ host })).status).toBe(404);
  });
});
