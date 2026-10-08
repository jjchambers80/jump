// Contract tests for Settings › Users (add users / staff of one organization).
//
// Covers: invite creates User + membership + one email and reads PENDING until
// the first session, an existing user gains a membership without a duplicate,
// the global role follows memberships, org scoping (X-Jump-Org cannot reach a
// foreign org, an ORGANIZER cannot manage users), last-admin and self guards,
// and resend only while pending.

import { jest } from '@jest/globals';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';

const sentEmails = [];
jest.unstable_mockModule('../../src/config/resend.js', () => ({
  default: { emails: { send: jest.fn(async (msg) => { sentEmails.push(msg); return { id: 'mock' }; }) } },
}));

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');

const TAG = `members-ct-${process.pid}-${Date.now()}`;
const staffEmails = [`admin@${TAG}.test`, `organizer@${TAG}.test`, `other-admin@${TAG}.test`];
const newEmail = `new@${TAG}.test`;
const auth = (token) => ['Authorization', `Bearer ${token}`];

describe('Settings › Users contract', () => {
  let org;
  let otherOrg;
  let adminToken;
  let adminId;
  let organizerToken;
  let organizerId;
  let otherAdminToken;
  let otherAdminId;

  beforeAll(async () => {
    org = await prisma.organization.create({ data: { name: `${TAG} Store`, logoUrl: 'https://cdn.example.test/logo.png', brandColor: '#d6007d' } });
    otherOrg = await prisma.organization.create({ data: { name: `${TAG} Other` } });
    adminToken = await staffToken({ email: staffEmails[0], role: 'ADMIN', name: 'Ada Admin' });
    organizerToken = await staffToken({ email: staffEmails[1], role: 'ORGANIZER' });
    otherAdminToken = await staffToken({ email: staffEmails[2], role: 'ADMIN' });
    adminId = jwt.decode(adminToken).sub;
    organizerId = jwt.decode(organizerToken).sub;
    otherAdminId = jwt.decode(otherAdminToken).sub;
    await joinOrgByToken(adminToken, org.id, 'ADMIN');
    await joinOrgByToken(organizerToken, org.id, 'ORGANIZER');
    await joinOrgByToken(otherAdminToken, otherOrg.id, 'ADMIN');
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: `@${TAG}.test` } } });
    await prisma.organization.deleteMany({ where: { id: { in: [org.id, otherOrg.id] } } });
    await cleanupStaff(staffEmails);
  });

  test('invite a new email: user + membership + email, PENDING until first sign-in', async () => {
    sentEmails.length = 0;
    const res = await request(app)
      .post('/admin/settings/users')
      .set(...auth(adminToken))
      .send({ emails: [` ${newEmail.toUpperCase()} `], role: 'ORGANIZER', requireTwoStep: true });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ invited: [newEmail], alreadyMember: [], emailFailed: [] });

    const user = await prisma.user.findUnique({ where: { email: newEmail }, include: { memberships: true } });
    expect(user.role).toBe('ORGANIZER');
    expect(user.memberships).toHaveLength(1);
    expect(user.memberships[0]).toMatchObject({ organizationId: org.id, role: 'ORGANIZER', requireTwoStep: true, invitedById: adminId });

    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].to).toEqual([newEmail]);
    expect(sentEmails[0].subject).toBe(`${org.name} invited you to Eventimus`);
    // The button opens the Eventimus sign-in page, so the email is platform-branded:
    // platform sender and colors, no store logo; the link names the org and the invitee
    const signIn = new URL(sentEmails[0].html.match(/href="([^"]*\/auth\/signin[^"]*)"/)[1].replace(/&amp;/g, '&'));
    expect(Object.fromEntries(signIn.searchParams)).toEqual({ callbackUrl: '/admin', invite: org.id, email: newEmail });
    expect(sentEmails[0].from).not.toContain(org.name);
    expect(sentEmails[0].html).not.toContain('cdn.example.test/logo.png');
    expect(sentEmails[0].html).not.toContain('#d6007d');
    expect(sentEmails[0].html).toContain('background-color: #2563eb;');
    expect(sentEmails[0].html).toContain('Two-step authentication is required');

    const list = await request(app).get('/admin/settings/users').set(...auth(adminToken));
    expect(list.status).toBe(200);
    const row = list.body.users.find((u) => u.email === newEmail);
    expect(row).toMatchObject({ role: 'ORGANIZER', status: 'PENDING', requireTwoStep: true, twoStepEnabled: false });
    // Only this organization's members
    expect(list.body.users.map((u) => u.id)).not.toContain(otherAdminId);

    const pending = await request(app).get('/admin/settings/users?status=PENDING').set(...auth(adminToken));
    expect(pending.body.users.map((u) => u.email)).toEqual([newEmail]);

    // The first sign-in creates a session: the row turns ACTIVE
    await prisma.userSession.create({ data: { userId: user.id, provider: 'resend' } });
    const after = await request(app).get('/admin/settings/users').set(...auth(adminToken));
    expect(after.body.users.find((u) => u.email === newEmail).status).toBe('ACTIVE');
  });

  test('already a member is reported, not duplicated or emailed', async () => {
    sentEmails.length = 0;
    const res = await request(app)
      .post('/admin/settings/users')
      .set(...auth(adminToken))
      .send({ emails: [newEmail, staffEmails[1]], role: 'ADMIN' });
    expect(res.status).toBe(201);
    expect(res.body.invited).toEqual([]);
    expect(res.body.alreadyMember.sort()).toEqual([newEmail, staffEmails[1]].sort());
    expect(sentEmails).toHaveLength(0);
  });

  test('an existing user from another org gains a membership; global role follows', async () => {
    const res = await request(app)
      .post('/admin/settings/users')
      .set(...auth(otherAdminToken))
      .send({ emails: [staffEmails[1]], role: 'ADMIN' });
    expect(res.status).toBe(201);
    expect(res.body.invited).toEqual([staffEmails[1]]);
    expect(await prisma.user.count({ where: { email: staffEmails[1] } })).toBe(1);
    let user = await prisma.user.findUnique({ where: { id: organizerId } });
    expect(user.role).toBe('ADMIN');

    // Removing that ADMIN membership drops the global role back to ORGANIZER
    const del = await request(app).delete(`/admin/settings/users/${organizerId}`).set(...auth(otherAdminToken));
    expect(del.status).toBe(204);
    user = await prisma.user.findUnique({ where: { id: organizerId } });
    expect(user.role).toBe('ORGANIZER');
  });

  test('an ORGANIZER cannot manage users', async () => {
    const res = await request(app).get('/admin/settings/users').set(...auth(organizerToken));
    expect(res.status).toBe(403);
  });

  test('a global ADMIN who is only ORGANIZER in the active org is refused', async () => {
    await joinOrgByToken(otherAdminToken, org.id, 'ORGANIZER');
    const res = await request(app)
      .get('/admin/settings/users')
      .set(...auth(otherAdminToken))
      .set('X-Jump-Org', org.id);
    expect(res.status).toBe(403);
    await prisma.organizationMember.deleteMany({ where: { userId: otherAdminId, organizationId: org.id } });
  });

  test('X-Jump-Org for a foreign org falls back to the caller’s own org', async () => {
    const res = await request(app)
      .get('/admin/settings/users')
      .set(...auth(adminToken))
      .set('X-Jump-Org', otherOrg.id);
    expect(res.status).toBe(200);
    expect(res.body.users.map((u) => u.id)).toContain(adminId);
    expect(res.body.users.map((u) => u.id)).not.toContain(otherAdminId);
    const patch = await request(app)
      .patch(`/admin/settings/users/${otherAdminId}`)
      .set(...auth(adminToken))
      .set('X-Jump-Org', otherOrg.id)
      .send({ role: 'ORGANIZER' });
    expect(patch.status).toBe(404);
  });

  test('validation', async () => {
    const bad = [
      { emails: [], role: 'ADMIN' },
      { emails: ['not-an-email'], role: 'ADMIN' },
      { emails: [`x@${TAG}.test`], role: 'SYSTEM_ADMIN' },
      { emails: [`x@${TAG}.test`], role: 'ADMIN', requireTwoStep: 'yes' },
    ];
    for (const body of bad) {
      const res = await request(app).post('/admin/settings/users').set(...auth(adminToken)).send(body);
      expect(res.status).toBe(400);
    }
    const patch = await request(app).patch(`/admin/settings/users/${organizerId}`).set(...auth(adminToken)).send({ email: 'x' });
    expect(patch.status).toBe(400);
  });

  test('PATCH role and requireTwoStep; self and last-admin guards', async () => {
    const res = await request(app)
      .patch(`/admin/settings/users/${organizerId}`)
      .set(...auth(adminToken))
      .send({ role: 'ADMIN', requireTwoStep: true });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ role: 'ADMIN', requireTwoStep: true });
    expect((await prisma.user.findUnique({ where: { id: organizerId } })).role).toBe('ADMIN');

    const self = await request(app).patch(`/admin/settings/users/${adminId}`).set(...auth(adminToken)).send({ role: 'ORGANIZER' });
    expect(self.status).toBe(403);
    const removeSelf = await request(app).delete(`/admin/settings/users/${adminId}`).set(...auth(adminToken));
    expect(removeSelf.status).toBe(403);

    const back = await request(app).patch(`/admin/settings/users/${organizerId}`).set(...auth(adminToken)).send({ role: 'ORGANIZER' });
    expect(back.status).toBe(200);
    expect((await prisma.user.findUnique({ where: { id: organizerId } })).role).toBe('ORGANIZER');
  });

  test('the last admin cannot be demoted or removed', async () => {
    const lone = await prisma.organization.create({ data: { name: `${TAG} Lone` } });
    const loneAdminToken = await staffToken({ email: `lone@${TAG}.test`, role: 'ADMIN' });
    await joinOrgByToken(loneAdminToken, lone.id, 'ADMIN');
    const sys = await prisma.user.create({ data: { email: `sys@${TAG}.test`, role: 'SYSTEM_ADMIN' } });
    const sysToken = jwt.sign({ sub: sys.id, email: sys.email, role: 'SYSTEM_ADMIN' }, process.env.AUTH_SECRET, { algorithm: 'HS256' });
    const loneId = jwt.decode(loneAdminToken).sub;

    const demote = await request(app)
      .patch(`/admin/settings/users/${loneId}`)
      .set(...auth(sysToken))
      .set('X-Jump-Org', lone.id)
      .send({ role: 'ORGANIZER' });
    expect(demote.status).toBe(409);
    const remove = await request(app).delete(`/admin/settings/users/${loneId}`).set(...auth(sysToken)).set('X-Jump-Org', lone.id);
    expect(remove.status).toBe(409);
    await prisma.organization.delete({ where: { id: lone.id } });
  });

  test('deactivate only a user who belongs to this org alone', async () => {
    const res = await request(app).patch(`/admin/settings/users/${organizerId}`).set(...auth(adminToken)).send({ isActive: false });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('INACTIVE');
    await request(app).patch(`/admin/settings/users/${organizerId}`).set(...auth(adminToken)).send({ isActive: true });

    await joinOrgByToken(organizerToken, otherOrg.id, 'ORGANIZER');
    const shared = await request(app).patch(`/admin/settings/users/${organizerId}`).set(...auth(adminToken)).send({ isActive: false });
    expect(shared.status).toBe(403);
    await prisma.organizationMember.deleteMany({ where: { userId: organizerId, organizationId: otherOrg.id } });
  });

  test('resend only while pending', async () => {
    const email = `resend@${TAG}.test`;
    await request(app).post('/admin/settings/users').set(...auth(adminToken)).send({ emails: [email], role: 'ORGANIZER' });
    const user = await prisma.user.findUnique({ where: { email } });

    sentEmails.length = 0;
    const ok = await request(app).post(`/admin/settings/users/${user.id}/resend`).set(...auth(adminToken));
    expect(ok.status).toBe(204);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].to).toEqual([email]);

    const signedIn = await request(app).post(`/admin/settings/users/${organizerId}/resend`).set(...auth(adminToken));
    expect(signedIn.status).toBe(409);
  });

  describe('secure sign-in method (requireTwoStep) enforcement', () => {
    const setupToken = () =>
      jwt.sign(
        { sub: organizerId, email: staffEmails[1], role: 'ORGANIZER', twoStepSetup: 'required' },
        process.env.AUTH_SECRET,
        { algorithm: 'HS256', expiresIn: '1h' }
      );

    test('only the account, staff auth and the org list are open until two-step is on', async () => {
      const token = setupToken();
      const blocked = await request(app).get('/admin/dashboard/overview').set(...auth(token));
      expect(blocked.status).toBe(403);
      expect(blocked.body.code).toBe('TWO_STEP_SETUP_REQUIRED');
      const blockedWrite = await request(app).post('/organizations').set(...auth(token)).send({ name: 'x' });
      expect(blockedWrite.body.code).toBe('TWO_STEP_SETUP_REQUIRED');

      expect((await request(app).get('/account').set(...auth(token))).status).toBe(200);
      expect((await request(app).get('/organizations').set(...auth(token))).status).toBe(200);
    });

    test('two-step cannot be turned off while an organization requires it', async () => {
      await prisma.organizationMember.update({
        where: { userId_organizationId: { userId: organizerId, organizationId: org.id } },
        data: { requireTwoStep: true },
      });
      sentEmails.length = 0;
      await request(app).post('/account/reauth/start').set(...auth(organizerToken)).send({ method: 'email' }).expect(200);
      const code = String(sentEmails[0].subject).match(/^(\d{6}) is your/)[1];
      const proof = await request(app).post('/account/reauth').set(...auth(organizerToken)).send({ code }).expect(200);

      const res = await request(app)
        .post('/account/two-step/disable')
        .set(...auth(organizerToken))
        .set('X-Jump-Reauth', proof.body.reauthToken)
        .send({ code: '123456' });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('TWO_STEP_REQUIRED_BY_ORGANIZATION');
      expect(res.body.message).toContain(org.name);
      await prisma.organizationMember.update({
        where: { userId_organizationId: { userId: organizerId, organizationId: org.id } },
        data: { requireTwoStep: false },
      });
    });
  });
});
