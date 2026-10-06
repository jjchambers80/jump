// Contract tests for agent access switches and grant management UI (spec 045C).
// Covers Settings › Agent access (org ADMIN), Account › Connected apps (any staff),
// and Settings › Platform (SYSTEM_ADMIN only).

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import request from 'supertest';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';
import { issueReauthProof } from '../../src/middleware/recentAuth.js';
const { default: app } = await import('../../src/api/server.js');
import { prisma } from '@jump/db';

const TAG = 'agent-access-ct';
const emails = [
  `admin-a@${TAG}.test`,
  `organizer-a@${TAG}.test`,
  `admin-b@${TAG}.test`,
  `system@${TAG}.test`,
];

const bearer = (token) => ['Authorization', `Bearer ${token}`];
const reauth = (token) => ['X-Jump-Reauth', issueReauthProof(token).reauthToken];

describe('Agent access contract (045C)', () => {
  let orgA;
  let orgB;
  let adminTokenA;
  let organizerTokenA;
  let adminTokenB;
  let systemToken;

  beforeAll(async () => {
    // Clean up any existing test data
    await prisma.oAuthGrant.deleteMany({
      where: { user: { email: { startsWith: `admin-a@${TAG}` } } },
    }).catch(() => {});
    await prisma.organization.deleteMany({ where: { name: { startsWith: `${TAG} ` } } }).catch(() => {});

    adminTokenA = await staffToken({ email: emails[0], role: 'ADMIN' });
    organizerTokenA = await staffToken({ email: emails[1], role: 'ORGANIZER' });
    adminTokenB = await staffToken({ email: emails[2], role: 'ADMIN' });
    systemToken = await staffToken({ email: emails[3], role: 'SYSTEM_ADMIN' });

    orgA = await prisma.organization.create({
      data: { name: `${TAG} Org A`, slug: `${TAG}-org-a`, agentAccessEnabled: false },
    });
    orgB = await prisma.organization.create({
      data: { name: `${TAG} Org B`, slug: `${TAG}-org-b`, agentAccessEnabled: false },
    });

    await joinOrgByToken(adminTokenA, orgA.id, 'ADMIN');
    await joinOrgByToken(organizerTokenA, orgA.id, 'ORGANIZER');
    await joinOrgByToken(adminTokenB, orgB.id, 'ADMIN');
    await joinOrgByToken(systemToken, orgA.id, 'ADMIN');
  });

  afterAll(async () => {
    await prisma.oAuthGrant.deleteMany({
      where: { organizationId: { in: [orgA.id, orgB.id] } },
    });
    await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } }).catch(() => {});
    await cleanupStaff(emails);
  });

  // Helper to create a grant directly in DB for testing
  async function createGrant(organizationId, userId, clientName = 'Test Client') {
    const client = await prisma.oAuthClient.create({
      data: {
        clientId: `test-client-${randomId()}`,
        kind: 'FIRST_PARTY',
        name: clientName,
        redirectUris: ['http://localhost/callback'],
      },
    });
    return prisma.oAuthGrant.create({
      data: {
        userId,
        organizationId,
        clientId: client.clientId,
        scopes: ['store:read', 'content:write'],
      },
    });
  }

  function randomId() {
    return Math.random().toString(36).slice(2, 10);
  }

  describe('Settings › Agent access (org ADMIN)', () => {
    it('GET /admin/agent-access/settings returns current switch state', async () => {
      const res = await request(app)
        .get('/admin/agent-access/settings')
        .set(...bearer(adminTokenA))
        .set('X-Jump-Org', orgA.id);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ agentAccessEnabled: false });
    });

    it('PATCH /admin/agent-access/settings toggles the switch (requires reauth)', async () => {
      const res = await request(app)
        .patch('/admin/agent-access/settings')
        .set(...bearer(adminTokenA))
        .set(...reauth(adminTokenA))
        .set('X-Jump-Org', orgA.id)
        .send({ enabled: true });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ agentAccessEnabled: true });

      // Verify persisted
      const org = await prisma.organization.findUnique({ where: { id: orgA.id } });
      expect(org.agentAccessEnabled).toBe(true);
    });

    it('PATCH without reauth returns 401 REAUTH_REQUIRED', async () => {
      const res = await request(app)
        .patch('/admin/agent-access/settings')
        .set(...bearer(adminTokenA))
        .set('X-Jump-Org', orgA.id)
        .send({ enabled: false });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('REAUTH_REQUIRED');
    });

    it('ORGANIZER cannot toggle (403)', async () => {
      const res = await request(app)
        .patch('/admin/agent-access/settings')
        .set(...bearer(organizerTokenA))
        .set(...reauth(organizerTokenA))
        .set('X-Jump-Org', orgA.id)
        .send({ enabled: true });
      expect(res.status).toBe(403);
    });

    it('ADMIN of org B cannot access org A settings (404/403)', async () => {
      const res = await request(app)
        .get('/admin/agent-access/settings')
        .set(...bearer(adminTokenB))
        .set('X-Jump-Org', orgA.id);
      expect([403, 404]).toContain(res.status);
    });
  });

  describe('Grants list and revocation (org ADMIN)', () => {
    let grantA;
    let grantB;

    beforeAll(async () => {
      // Create grants for orgA by adminTokenA user
      const adminA = await prisma.user.findUnique({ where: { email: emails[0] } });
      grantA = await createGrant(orgA.id, adminA.id, 'Claude');
      grantB = await createGrant(orgA.id, adminA.id, 'ChatGPT');
      // Create a grant for orgB by adminTokenB user
      const adminB = await prisma.user.findUnique({ where: { email: emails[2] } });
      await createGrant(orgB.id, adminB.id, 'Codex');
    });

    it('GET /admin/agent-access/grants lists only active org grants', async () => {
      const res = await request(app)
        .get('/admin/agent-access/grants')
        .set(...bearer(adminTokenA))
        .set('X-Jump-Org', orgA.id);
      expect(res.status).toBe(200);
      expect(res.body.grants.length).toBe(2);
      expect(res.body.grants.every((g) => g.organizationId === orgA.id)).toBe(true);
    });

    it('POST /admin/agent-access/grants/:id/revoke revokes one grant (requires reauth)', async () => {
      const res = await request(app)
        .post(`/admin/agent-access/grants/${grantA.id}/revoke`)
        .set(...bearer(adminTokenA))
        .set(...reauth(adminTokenA))
        .set('X-Jump-Org', orgA.id);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(grantA.id);
      expect(res.body.revokedAt).toBeDefined();

      const grant = await prisma.oAuthGrant.findUnique({ where: { id: grantA.id } });
      expect(grant.revokedAt).not.toBeNull();
      expect(grant.revokedReason).toBe('org_admin');
    });

    it('POST without reauth returns 401 REAUTH_REQUIRED', async () => {
      const res = await request(app)
        .post(`/admin/agent-access/grants/${grantB.id}/revoke`)
        .set(...bearer(adminTokenA))
        .set('X-Jump-Org', orgA.id);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('REAUTH_REQUIRED');
    });

    it('POST /admin/agent-access/grants/revoke-all revokes all org grants (requires reauth)', async () => {
      // Create another grant
      const adminA = await prisma.user.findUnique({ where: { email: emails[0] } });
      await createGrant(orgA.id, adminA.id, 'Another');

      const res = await request(app)
        .post('/admin/agent-access/grants/revoke-all')
        .set(...bearer(adminTokenA))
        .set(...reauth(adminTokenA))
        .set('X-Jump-Org', orgA.id);
      expect(res.status).toBe(200);
      expect(res.body.count).toBeGreaterThan(0);

      const active = await prisma.oAuthGrant.count({ where: { organizationId: orgA.id, revokedAt: null } });
      expect(active).toBe(0);
    });

    it('ORGANIZER cannot list or revoke grants (403)', async () => {
      const res = await request(app)
        .get('/admin/agent-access/grants')
        .set(...bearer(organizerTokenA))
        .set('X-Jump-Org', orgA.id);
      expect(res.status).toBe(403);
    });
  });

  describe('Audit log (org ADMIN)', () => {
    let grant;

    beforeAll(async () => {
      const adminA = await prisma.user.findUnique({ where: { email: emails[0] } });
      grant = await createGrant(orgA.id, adminA.id, 'Audit Test');
      // Create an audit log entry
      await prisma.agentAuditLog.create({
        data: {
          organizationId: orgA.id,
          userId: adminA.id,
          grantId: grant.id,
          clientName: 'Audit Test',
          tool: 'list_events',
          argsDigest: 'abc123',
          summary: 'Listed events',
          outcome: 'ok',
        },
      });
    });

    it('GET /admin/agent-access/audit-log returns filtered results', async () => {
      const res = await request(app)
        .get('/admin/agent-access/audit-log')
        .set(...bearer(adminTokenA))
        .set('X-Jump-Org', orgA.id);
      expect(res.status).toBe(200);
      expect(res.body.rows.length).toBeGreaterThan(0);
      expect(res.body.rows[0]).toMatchObject({
        tool: 'list_events',
        outcome: 'ok',
      });
    });

    it('filters by grantId', async () => {
      const res = await request(app)
        .get(`/admin/agent-access/audit-log?grantId=${grant.id}`)
        .set(...bearer(adminTokenA))
        .set('X-Jump-Org', orgA.id);
      expect(res.status).toBe(200);
      expect(res.body.rows.every((r) => r.grantId === grant.id)).toBe(true);
    });

    it('filters by tool', async () => {
      const res = await request(app)
        .get('/admin/agent-access/audit-log?tool=list_events')
        .set(...bearer(adminTokenA))
        .set('X-Jump-Org', orgA.id);
      expect(res.status).toBe(200);
      expect(res.body.rows.every((r) => r.tool === 'list_events')).toBe(true);
    });
  });

  describe('Account › Connected apps (any staff)', () => {
    let grantA;
    let grantB;

    beforeAll(async () => {
      const adminA = await prisma.user.findUnique({ where: { email: emails[0] } });
      grantA = await createGrant(orgA.id, adminA.id, 'Claude (me)');
      grantB = await createGrant(orgB.id, adminA.id, 'Codex (me)');
      // Another user's grant
      const organizerA = await prisma.user.findUnique({ where: { email: emails[1] } });
      await createGrant(orgA.id, organizerA.id, 'Other user grant');
    });

    it('GET /admin/agent-access/my-grants returns only the calling user grants', async () => {
      const res = await request(app)
        .get('/admin/agent-access/my-grants')
        .set(...bearer(adminTokenA));
      expect(res.status).toBe(200);
      expect(res.body.grants.length).toBe(2);
      expect(res.body.grants.every((g) => g.userId === adminA.id)).toBe(true);
    });

    it('POST /admin/agent-access/my-grants/:id/revoke revokes own grant', async () => {
      const res = await request(app)
        .post(`/admin/agent-access/my-grants/${grantA.id}/revoke`)
        .set(...bearer(adminTokenA));
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(grantA.id);
      expect(res.body.revokedAt).toBeDefined();
    });

    it('cannot revoke another user grant (404)', async () => {
      const res = await request(app)
        .post(`/admin/agent-access/my-grants/${grantB.id}/revoke`)
        .set(...bearer(organizerTokenA)); // Different user
      expect(res.status).toBe(404);
    });

    it('ORGANIZER can access their own grants', async () => {
      const res = await request(app)
        .get('/admin/agent-access/my-grants')
        .set(...bearer(organizerTokenA));
      expect(res.status).toBe(200);
    });
  });

  describe('Settings › Platform (SYSTEM_ADMIN only)', () => {
    it('GET /admin/platform/settings returns global switch', async () => {
      const res = await request(app)
        .get('/admin/platform/settings')
        .set(...bearer(systemToken));
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('agentAccessEnabled');
    });

    it('PATCH /admin/platform/settings toggles global switch', async () => {
      const res = await request(app)
        .patch('/admin/platform/settings')
        .set(...bearer(systemToken))
        .send({ enabled: true });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ agentAccessEnabled: true });
    });

    it('ADMIN cannot access platform settings (403)', async () => {
      const res = await request(app)
        .get('/admin/platform/settings')
        .set(...bearer(adminTokenA));
      expect(res.status).toBe(403);
    });

    it('GET /admin/platform/stats returns platform-wide counts', async () => {
      const res = await request(app)
        .get('/admin/platform/stats')
        .set(...bearer(systemToken));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        grantCount: expect.any(Number),
        callCount: expect.any(Number),
        currentTokens: expect.any(Number),
      });
    });

    it('POST /admin/platform/revoke-all requires exact confirmation', async () => {
      const res = await request(app)
        .post('/admin/platform/revoke-all')
        .set(...bearer(systemToken))
        .send({ confirmation: 'WRONG' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_CONFIRMATION');
    });

    it('POST /admin/platform/revoke-all revokes all grants', async () => {
      const res = await request(app)
        .post('/admin/platform/revoke-all')
        .set(...bearer(systemToken))
        .send({ confirmation: 'REVOKE ALL GRANTS' });
      expect(res.status).toBe(200);
      expect(res.body.count).toBeGreaterThanOrEqual(0);

      const active = await prisma.oAuthGrant.count({ where: { revokedAt: null } });
      expect(active).toBe(0);
    });
  });
});