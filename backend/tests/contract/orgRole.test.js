// Contract tests for role checks in the active organization.
//
// User.role is ADMIN when *any* membership is ADMIN, so the account-wide role
// must never decide what someone may do inside one organization. A user who is
// ADMIN of A and ORGANIZER of B gets ADMIN routes only while acting in A —
// whether the org comes from X-Jump-Org or from a route param.

import request from 'supertest';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');
const { default: permissionService } = await import('../../src/services/PermissionService.js');

// Overrides are pinned in this worker's cache, never written: suites share one
// database and run in parallel.
function pinRoles(value) {
  permissionService._cache = { at: Date.now() + 3_600_000, value: { ADMIN: {}, ORGANIZER: {}, disabled: [], ...value } };
}

const TAG = `org-role-ct-${process.pid}-${Date.now()}`;
const staffEmails = [`both@${TAG}.test`, `outsider@${TAG}.test`];
const auth = (token) => ['Authorization', `Bearer ${token}`];

describe('role in the active organization', () => {
  let orgA;
  let orgB;
  let token;
  let outsiderToken;

  beforeAll(async () => {
    orgA = await prisma.organization.create({ data: { name: `${TAG} A` } });
    orgB = await prisma.organization.create({ data: { name: `${TAG} B` } });
    token = await staffToken({ email: staffEmails[0], role: 'ADMIN' });
    await joinOrgByToken(token, orgA.id, 'ADMIN');
    await joinOrgByToken(token, orgB.id, 'ORGANIZER');
    outsiderToken = await staffToken({ email: staffEmails[1], role: 'ADMIN' });
    await joinOrgByToken(outsiderToken, orgB.id, 'ADMIN');
  });

  afterAll(async () => {
    await cleanupStaff(staffEmails);
    await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  });

  test('ADMIN route: allowed in the org where the caller is ADMIN', async () => {
    const res = await request(app).get('/admin/settings/users').set(...auth(token)).set('X-Jump-Org', orgA.id);
    expect(res.status).toBe(200);
  });

  test('ADMIN route: refused in the org where the caller is only ORGANIZER', async () => {
    const res = await request(app).get('/admin/settings/users').set(...auth(token)).set('X-Jump-Org', orgB.id);
    expect(res.status).toBe(403);
    const tax = await request(app)
      .patch('/admin/settings/tax')
      .set(...auth(token))
      .set('X-Jump-Org', orgB.id)
      .send({ taxInclusivePricing: true });
    expect(tax.status).toBe(403);
  });

  test('ORGANIZER route still works in either org', async () => {
    for (const org of [orgA, orgB]) {
      const res = await request(app).get('/admin/developer-tokens').set(...auth(token)).set('X-Jump-Org', org.id);
      expect(res.status).toBe(200);
    }
  });

  test('canEdit follows the role in the active org', async () => {
    const a = await request(app).get('/admin/settings/tax').set(...auth(token)).set('X-Jump-Org', orgA.id);
    const b = await request(app).get('/admin/settings/tax').set(...auth(token)).set('X-Jump-Org', orgB.id);
    expect(a.status).toBe(200);
    expect(a.body.canEdit).toBe(true);
    expect(b.status).toBe(200);
    expect(b.body.canEdit).toBe(false);
  });

  test('route param org: ADMIN of A cannot edit B, not even with X-Jump-Org = A', async () => {
    const own = await request(app).get(`/organizations/${orgA.id}`).set(...auth(token));
    expect(own.status).toBe(200);
    const res = await request(app)
      .patch(`/organizations/${orgB.id}`)
      .set(...auth(token))
      .set('X-Jump-Org', orgA.id)
      .send({ name: 'Renamed' });
    expect(res.status).toBe(403);
  });

  test('a non-member gets nothing in an org it does not belong to', async () => {
    const res = await request(app).get(`/organizations/${orgA.id}`).set(...auth(outsiderToken));
    expect(res.status).toBe(403);
  });

  describe('System › Roles overrides', () => {
    afterEach(() => permissionService.clearCache());

    test('an action granted to ORGANIZER passes the guard; by default it is refused', async () => {
      const refund = () =>
        request(app).post('/admin/orders/no-such-order/refund').set(...auth(token)).set('X-Jump-Org', orgB.id).send({});
      pinRoles({});
      expect((await refund()).status).toBe(403);
      pinRoles({ ORGANIZER: { 'orders.refund': true } });
      expect((await refund()).status).not.toBe(403);
    });

    test('a feature hidden for ORGANIZER answers 403 to them and stays open to ADMIN', async () => {
      pinRoles({ ORGANIZER: { maps: false } });
      expect((await request(app).get('/admin/maps').set(...auth(token)).set('X-Jump-Org', orgB.id)).status).toBe(403);
      expect((await request(app).get('/admin/maps').set(...auth(token)).set('X-Jump-Org', orgA.id)).status).toBe(200);
    });

    test('a feature turned off platform-wide is 404 for every role', async () => {
      pinRoles({ disabled: ['finance'] });
      expect((await request(app).get('/admin/finance/payouts').set(...auth(token)).set('X-Jump-Org', orgA.id)).status).toBe(404);
    });

    test('GET /admin/permissions describes the caller in the active org', async () => {
      pinRoles({ ORGANIZER: { customers: false, 'orders.refund': true } });
      const b = await request(app).get('/admin/permissions').set(...auth(token)).set('X-Jump-Org', orgB.id);
      expect(b.status).toBe(200);
      expect(b.body.role).toBe('ORGANIZER');
      expect(b.body.granted).toEqual(expect.arrayContaining(['events', 'orders.refund']));
      expect(b.body.granted).not.toContain('customers');
      expect(b.body.granted).not.toContain('settings.tax');
      expect(b.body.hiddenPaths).toEqual(['/admin/customers']);
      const a = await request(app).get('/admin/permissions').set(...auth(token)).set('X-Jump-Org', orgA.id);
      expect(a.body.role).toBe('ADMIN');
      expect(a.body.granted).toContain('settings.tax');
      expect(a.body.hiddenPaths).toEqual([]);
    });
  });
});
