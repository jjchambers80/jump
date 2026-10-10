// Contract tests: System administration API (/admin/system).
//
// Platform-wide and SYSTEM_ADMIN only. Mutations need a step-up proof; a
// system admin never changes themselves; the last active system admin can
// never be removed; every change is audited in SecurityEvent.

import { jest } from '@jest/globals';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const sentEmails = [];
jest.unstable_mockModule('../../src/config/resend.js', () => ({
  default: { emails: { send: jest.fn(async (msg) => { sentEmails.push(msg); return { id: 'mock' }; }) } },
}));

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');
const { staffToken, cleanupStaff, joinOrgByToken } = await import('../helpers/staff.js');
const { issueReauthProof } = await import('../../src/middleware/recentAuth.js');
const { default: systemAdminService } = await import('../../src/services/SystemAdminService.js');

const TAG = 'admin-system-sa3';
const SYS_EMAIL = `sys@${TAG}.test`;
const ADMIN_EMAIL = `admin@${TAG}.test`;
const NOBODY_EMAIL = `nobody@${TAG}.test`;
const STAFF_EMAILS = [SYS_EMAIL, ADMIN_EMAIL, NOBODY_EMAIL];

const auth = (token) => ['Authorization', `Bearer ${token}`];
const reauth = (token) => ['X-Jump-Reauth', issueReauthProof(jwt.decode(token).sub).reauthToken];
const idOf = (token) => jwt.decode(token).sub;

let sysToken;
let adminToken;
let nobodyToken;
let org;

async function makeUser(local, data = {}) {
  return prisma.user.create({ data: { email: `${local}@${TAG}.test`, name: `${local} user`, ...data } });
}

const eventsOf = (userId, type) => prisma.securityEvent.findMany({ where: { userId, type } });

beforeAll(async () => {
  sysToken = await staffToken({ email: SYS_EMAIL, role: 'SYSTEM_ADMIN', name: 'Sys Admin' });
  adminToken = await staffToken({ email: ADMIN_EMAIL, role: 'ADMIN' });
  nobodyToken = await staffToken({ email: NOBODY_EMAIL, role: 'UNASSIGNED' });
  org = (await request(app).post('/organizations').set(...auth(adminToken)).send({ name: `${TAG} Home Org` })).body;
  await joinOrgByToken(adminToken, org.id, 'ADMIN');
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TAG}.test` } } });
  await cleanupStaff(STAFF_EMAILS);
});

describe('access', () => {
  const routes = [
    ['get', '/admin/system/overview'],
    ['get', '/admin/system/organizations'],
    ['get', '/admin/system/organizations/x'],
    ['patch', '/admin/system/organizations/x/status'],
    ['get', '/admin/system/users'],
    ['post', '/admin/system/users/invite'],
    ['patch', '/admin/system/users/x'],
  ];

  it.each(routes)('%s %s is 403 for an org ADMIN and for UNASSIGNED', async (method, path) => {
    for (const token of [adminToken, nobodyToken]) {
      const res = await request(app)[method](path).set(...auth(token)).set(...reauth(token)).send({});
      expect(res.status).toBe(403);
    }
  });

  it.each(routes)('%s %s is 401 without a session', async (method, path) => {
    expect((await request(app)[method](path).send({})).status).toBe(401);
  });

  it.each([
    ['patch', '/admin/system/organizations/x/status', { status: 'INACTIVE' }],
    ['post', '/admin/system/users/invite', { email: `noproof@${TAG}.test` }],
    ['patch', '/admin/system/users/x', { isActive: false }],
  ])('%s %s needs a recent-auth proof', async (method, path, body) => {
    const res = await request(app)[method](path).set(...auth(sysToken)).send(body);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('REAUTH_REQUIRED');
  });
});

describe('GET /admin/system/overview', () => {
  it('returns platform counts and recent signups', async () => {
    const res = await request(app).get('/admin/system/overview').set(...auth(sysToken));
    expect(res.status).toBe(200);
    expect(res.body.organizations).toEqual(
      expect.objectContaining({ total: expect.any(Number), active: expect.any(Number), inactive: expect.any(Number), pending: expect.any(Number) })
    );
    expect(res.body.users.systemAdmins).toBeGreaterThanOrEqual(1);
    expect(res.body.onboarding).toHaveProperty('pending');
    expect(Array.isArray(res.body.recentSignups)).toBe(true);
  });
});

describe('organizations', () => {
  beforeAll(async () => {
    await prisma.organization.createMany({
      data: Array.from({ length: 22 }, (_, i) => ({
        name: `${TAG} Listed ${String(i).padStart(2, '0')}`,
        slug: `${TAG}-listed-${i}`,
        ...(i === 0 ? { status: 'INACTIVE' } : {}),
        ...(i === 1 ? { onboardingCompletedAt: null } : {}),
      })),
    });
  });

  it('searches by name and paginates 20 per page', async () => {
    const q = encodeURIComponent(`${TAG} Listed`);
    const p1 = await request(app).get(`/admin/system/organizations?q=${q}`).set(...auth(sysToken));
    expect(p1.status).toBe(200);
    expect(p1.body.pagination).toEqual({ page: 1, limit: 20, total: 22, totalPages: 2 });
    expect(p1.body.organizations).toHaveLength(20);
    const row = p1.body.organizations[0];
    expect(Object.keys(row).sort()).toEqual(
      ['createdAt', 'id', 'memberCount', 'name', 'onboardingCompletedAt', 'plan', 'slug', 'status', 'subscriptionStatus', 'venueCount'].sort()
    );
    const p2 = await request(app).get(`/admin/system/organizations?q=${q}&page=2`).set(...auth(sysToken));
    expect(p2.body.organizations).toHaveLength(2);
  });

  it('searches by slug and filters by status', async () => {
    const bySlug = await request(app).get(`/admin/system/organizations?q=${TAG}-listed-7`).set(...auth(sysToken));
    expect(bySlug.body.organizations.map((o) => o.slug)).toEqual([`${TAG}-listed-7`]);
    const inactive = await request(app).get(`/admin/system/organizations?q=${TAG}&status=INACTIVE`).set(...auth(sysToken));
    expect(inactive.body.organizations.map((o) => o.slug)).toEqual([`${TAG}-listed-0`]);
    const pending = await request(app).get(`/admin/system/organizations?q=${TAG}&status=PENDING`).set(...auth(sysToken));
    expect(pending.body.organizations.map((o) => o.slug)).toEqual([`${TAG}-listed-1`]);
  });

  it('rejects a bad status or page', async () => {
    expect((await request(app).get('/admin/system/organizations?status=NOPE').set(...auth(sysToken))).status).toBe(400);
    expect((await request(app).get('/admin/system/organizations?page=0').set(...auth(sysToken))).status).toBe(400);
  });

  it('GET /:id returns the organization and its members, ignoring X-Jump-Org', async () => {
    const res = await request(app).get(`/admin/system/organizations/${org.id}`).set(...auth(sysToken)).set('X-Jump-Org', 'someone-else');
    expect(res.status).toBe(200);
    expect(res.body.organization).toEqual(expect.objectContaining({ id: org.id, memberCount: 1, status: 'ACTIVE' }));
    expect(res.body.members).toEqual([expect.objectContaining({ email: ADMIN_EMAIL, role: 'ADMIN' })]);
    expect((await request(app).get('/admin/system/organizations/missing').set(...auth(sysToken))).status).toBe(404);
  });

  it('PATCH /:id/status persists, audits on the actor, and reactivates', async () => {
    const off = await request(app)
      .patch(`/admin/system/organizations/${org.id}/status`)
      .set(...auth(sysToken)).set(...reauth(sysToken))
      .send({ status: 'INACTIVE' });
    expect(off.status).toBe(200);
    expect(off.body.status).toBe('INACTIVE');
    expect((await prisma.organization.findUnique({ where: { id: org.id } })).status).toBe('INACTIVE');
    const [suspended] = await eventsOf(idOf(sysToken), 'ORG_SUSPENDED');
    expect(suspended.meta).toEqual({ organizationId: org.id });

    const on = await request(app)
      .patch(`/admin/system/organizations/${org.id}/status`)
      .set(...auth(sysToken)).set(...reauth(sysToken))
      .send({ status: 'ACTIVE' });
    expect(on.body.status).toBe('ACTIVE');
    expect(await eventsOf(idOf(sysToken), 'ORG_REACTIVATED')).toHaveLength(1);

    const bad = await request(app)
      .patch(`/admin/system/organizations/${org.id}/status`)
      .set(...auth(sysToken)).set(...reauth(sysToken))
      .send({ status: 'DELETED' });
    expect(bad.status).toBe(400);
  });

  it('an org ADMIN can no longer set status through PATCH /organizations/:id', async () => {
    const res = await request(app).patch(`/organizations/${org.id}`).set(...auth(adminToken)).send({ status: 'INACTIVE' });
    expect(res.status).toBe(403);
    const ok = await request(app).patch(`/organizations/${org.id}`).set(...auth(adminToken)).send({ name: `${TAG} Home Org` });
    expect(ok.status).toBe(200);
  });
});

describe('users', () => {
  it('lists with search, role and status filters and a memberships summary', async () => {
    const off = await makeUser('listed-off', { isActive: false });
    const res = await request(app).get(`/admin/system/users?q=${encodeURIComponent(`admin@${TAG}`)}`).set(...auth(sysToken));
    expect(res.status).toBe(200);
    expect(res.body.users.map((u) => u.email)).toEqual([ADMIN_EMAIL]);
    expect(res.body.users[0].organizations).toEqual([{ id: org.id, name: `${TAG} Home Org`, role: 'ADMIN' }]);
    expect(res.body.pagination).toEqual(expect.objectContaining({ page: 1, limit: 20, total: 1 }));

    const inactive = await request(app).get(`/admin/system/users?q=${TAG}&status=INACTIVE`).set(...auth(sysToken));
    expect(inactive.body.users.map((u) => u.id)).toEqual([off.id]);
    const admins = await request(app).get(`/admin/system/users?q=${TAG}&role=SYSTEM_ADMIN`).set(...auth(sysToken));
    expect(admins.body.users.every((u) => u.role === 'SYSTEM_ADMIN')).toBe(true);
    expect((await request(app).get('/admin/system/users?role=BOSS').set(...auth(sysToken))).status).toBe(400);
  });

  describe('POST /users/invite', () => {
    const invite = (body) =>
      request(app).post('/admin/system/users/invite').set(...auth(sysToken)).set(...reauth(sysToken)).send(body);

    it('creates a system admin, emails a sign-in link to /admin/system, and audits', async () => {
      const email = `invitee@${TAG}.test`;
      const res = await invite({ email: `  INVITEE@${TAG}.test `, name: 'New Admin' });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        user: expect.objectContaining({ email, name: 'New Admin', role: 'SYSTEM_ADMIN', organizations: [] }),
        promoted: false,
        emailSent: true,
      });
      const mail = [...sentEmails].reverse().find((m) => m.to.includes(email));
      expect(mail.subject).toMatch(/system admin/i);
      expect(mail.text).toContain('/auth/signin?callbackUrl=%2Fadmin%2Fsystem');
      const [event] = await eventsOf(res.body.user.id, 'SYSTEM_ADMIN_INVITED');
      expect(event.meta).toEqual({ actorId: idOf(sysToken), promoted: false });

      const again = await invite({ email });
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('ALREADY_SYSTEM_ADMIN');
    });

    it('promotes an existing user and drops their memberships', async () => {
      const organizer = await makeUser('organizer', { role: 'ORGANIZER', memberships: { create: { organizationId: org.id, role: 'ORGANIZER' } } });
      const res = await invite({ email: organizer.email });
      expect(res.status).toBe(201);
      expect(res.body.promoted).toBe(true);
      expect(res.body.user.role).toBe('SYSTEM_ADMIN');
      expect(await prisma.organizationMember.count({ where: { userId: organizer.id } })).toBe(0);
      expect(await eventsOf(organizer.id, 'SYSTEM_ROLE_GRANTED')).toHaveLength(1);
    });

    it('refuses a deleted account and a bad email', async () => {
      const gone = await makeUser('gone', { deletedAt: new Date() });
      const res = await invite({ email: gone.email });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('USER_DELETED');
      expect((await invite({ email: 'not-an-email' })).status).toBe(400);
    });
  });

  describe('PATCH /users/:id', () => {
    const patch = (id, body, token = sysToken) =>
      request(app).patch(`/admin/system/users/${id}`).set(...auth(token)).set(...reauth(token)).send(body);

    it('refuses to change yourself', async () => {
      const res = await patch(idOf(sysToken), { isActive: false });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('CANNOT_CHANGE_SELF');
    });

    it('refuses to remove the last active system admin', async () => {
      const target = await makeUser('last', { role: 'SYSTEM_ADMIN' });
      const spy = jest.spyOn(systemAdminService, '_otherActiveSystemAdmins').mockResolvedValue(0);
      try {
        for (const body of [{ role: 'UNASSIGNED' }, { isActive: false }]) {
          const res = await patch(target.id, body);
          expect(res.status).toBe(409);
          expect(res.body.code).toBe('LAST_SYSTEM_ADMIN');
        }
      } finally {
        spy.mockRestore();
      }
      const unchanged = await prisma.user.findUnique({ where: { id: target.id } });
      expect(unchanged).toEqual(expect.objectContaining({ role: 'SYSTEM_ADMIN', isActive: true }));
    });

    it('counts other active system admins for real', async () => {
      const target = await makeUser('counted', { role: 'SYSTEM_ADMIN' });
      // The acting admin is an active SYSTEM_ADMIN row, so at least one remains.
      expect(await systemAdminService._otherActiveSystemAdmins(prisma, target.id)).toBeGreaterThanOrEqual(1);
    });

    it('promotes through PATCH (memberships dropped) and demotes with an audit trail', async () => {
      const user = await makeUser('promoted', { role: 'ADMIN', memberships: { create: { organizationId: org.id, role: 'ADMIN' } } });
      const up = await patch(user.id, { role: 'SYSTEM_ADMIN' });
      expect(up.status).toBe(200);
      expect(up.body).toEqual(expect.objectContaining({ id: user.id, role: 'SYSTEM_ADMIN', organizations: [] }));
      expect(await eventsOf(user.id, 'SYSTEM_ROLE_GRANTED')).toEqual([
        expect.objectContaining({ meta: { actorId: idOf(sysToken) } }),
      ]);

      await prisma.userSession.create({ data: { userId: user.id } });
      const down = await patch(user.id, { role: 'UNASSIGNED' });
      expect(down.status).toBe(200);
      expect(down.body.role).toBe('UNASSIGNED');
      expect(await eventsOf(user.id, 'SYSTEM_ROLE_REVOKED')).toHaveLength(1);
      expect(await prisma.userSession.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
    });

    it('deactivation revokes every session; reactivation is audited', async () => {
      const user = await makeUser('deactivated', { role: 'ORGANIZER' });
      await prisma.userSession.createMany({ data: [{ userId: user.id }, { userId: user.id }] });

      const off = await patch(user.id, { isActive: false });
      expect(off.status).toBe(200);
      expect(off.body.isActive).toBe(false);
      const sessions = await prisma.userSession.findMany({ where: { userId: user.id } });
      expect(sessions.every((s) => s.revokedAt && s.revokedBy === 'deactivated')).toBe(true);
      expect(await eventsOf(user.id, 'USER_DEACTIVATED')).toHaveLength(1);

      const on = await patch(user.id, { isActive: true });
      expect(on.body.isActive).toBe(true);
      expect(await eventsOf(user.id, 'USER_REACTIVATED')).toHaveLength(1);
    });

    it('validates the body and refuses UNASSIGNED for a non-system user', async () => {
      const user = await makeUser('validated', { role: 'ORGANIZER', memberships: { create: { organizationId: org.id, role: 'ORGANIZER' } } });
      expect((await patch(user.id, { role: 'ADMIN' })).status).toBe(400);
      expect((await patch(user.id, { isActive: 'no' })).status).toBe(400);
      expect((await patch(user.id, { organizationId: org.id })).status).toBe(400);
      const res = await patch(user.id, { role: 'UNASSIGNED' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('NOT_SYSTEM_ADMIN');
      expect(await prisma.organizationMember.count({ where: { userId: user.id } })).toBe(1);
      expect((await patch('missing-user', { isActive: false })).status).toBe(404);
    });
  });

  it('PATCH /users/:id (legacy) refuses SYSTEM_ADMIN grants and targets, even for a system admin', async () => {
    const sys = await makeUser('legacy-sys', { role: 'SYSTEM_ADMIN' });
    const grant = await request(app).patch(`/users/${sys.id}`).set(...auth(sysToken)).send({ isActive: false });
    expect(grant.status).toBe(403);
    expect(grant.body.code).toBe('USE_SYSTEM_ADMIN_USERS');
    const plain = await makeUser('legacy-plain', { role: 'ORGANIZER' });
    expect((await request(app).patch(`/users/${plain.id}`).set(...auth(sysToken)).send({ role: 'SYSTEM_ADMIN' })).status).toBe(403);
    expect((await prisma.user.findUnique({ where: { id: plain.id } })).role).toBe('ORGANIZER');
  });
});
