// Contract tests for System › Roles & permissions (/admin/system/roles).
//
// Suites share one database and run in parallel, so the only write here saves
// the defaults (no overrides) — every other suite keeps today's rules.

import request from 'supertest';
import jwt from 'jsonwebtoken';
import { staffToken, cleanupStaff } from '../helpers/staff.js';

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');
const { issueReauthProof } = await import('../../src/middleware/recentAuth.js');

const TAG = `system-roles-ct-${process.pid}-${Date.now()}`;
const emails = [`sys@${TAG}.test`, `admin@${TAG}.test`];
const auth = (token) => ['Authorization', `Bearer ${token}`];
const reauth = (token) => ['X-Jump-Reauth', issueReauthProof(jwt.decode(token).sub).reauthToken];

describe('System › Roles', () => {
  let sysToken;
  let adminToken;
  let hadRow;

  beforeAll(async () => {
    sysToken = await staffToken({ email: emails[0], role: 'SYSTEM_ADMIN' });
    adminToken = await staffToken({ email: emails[1], role: 'ADMIN' });
    hadRow = !!(await prisma.platformSetting.findUnique({ where: { key: 'roles' } }));
  });

  afterAll(async () => {
    if (!hadRow) await prisma.platformSetting.deleteMany({ where: { key: 'roles' } });
    await cleanupStaff(emails);
  });

  test('GET returns the catalog, both member roles and the platform switches', async () => {
    const res = await request(app).get('/admin/system/roles').set(...auth(sysToken));
    expect(res.status).toBe(200);
    expect(res.body.features.map((f) => f.key)).toEqual(expect.arrayContaining(['events', 'customers', 'settings']));
    expect(res.body.features.find((f) => f.key === 'events')).toMatchObject({ locked: true, switchable: false });
    expect(Object.keys(res.body.roles)).toEqual(['ADMIN', 'ORGANIZER']);
    expect(res.body.defaults.ORGANIZER['orders.refund']).toBe(false);
    expect(Array.isArray(res.body.disabled)).toBe(true);
  });

  test('only SYSTEM_ADMIN reaches it', async () => {
    expect((await request(app).get('/admin/system/roles').set(...auth(adminToken))).status).toBe(403);
  });

  test('PUT needs a step-up proof', async () => {
    const res = await request(app).put('/admin/system/roles').set(...auth(sysToken)).send({ roles: {}, disabled: [] });
    expect([401, 403]).toContain(res.status);
  });

  test('PUT refuses a locked change, an unknown key and a malformed body', async () => {
    const put = (body) => request(app).put('/admin/system/roles').set(...auth(sysToken)).set(...reauth(sysToken)).send(body);
    expect((await put({ roles: { ORGANIZER: { 'settings.users': true } }, disabled: [] })).status).toBe(400);
    expect((await put({ roles: { ORGANIZER: { nope: true } }, disabled: [] })).status).toBe(400);
    expect((await put({ roles: {}, disabled: ['events'] })).status).toBe(400);
    expect((await put({ roles: [], disabled: [] })).status).toBe(400);
  });

  test('PUT saves the defaults as no overrides and records a security event', async () => {
    const current = (await request(app).get('/admin/system/roles').set(...auth(sysToken))).body;
    const res = await request(app)
      .put('/admin/system/roles')
      .set(...auth(sysToken))
      .set(...reauth(sysToken))
      .send({ roles: current.defaults, disabled: [] });
    expect(res.status).toBe(200);
    expect(res.body.roles).toEqual(current.defaults);
    const row = await prisma.platformSetting.findUnique({ where: { key: 'roles' } });
    expect(row.value).toEqual({ ADMIN: {}, ORGANIZER: {}, disabled: [] });
    const event = await prisma.securityEvent.findFirst({
      where: { userId: jwt.decode(sysToken).sub, type: 'ROLE_PERMISSIONS_CHANGED' },
    });
    expect(event).not.toBeNull();
  });
});
