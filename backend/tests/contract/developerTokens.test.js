// Contract tests for Jump CLI sign-in and developer tokens (spec 043, card
// 043A): loopback + PKCE code exchange, single use, scope (themes only),
// revocation, membership removal and Settings › Developers.

import { createHash, randomBytes } from 'crypto';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import request from 'supertest';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';

process.env.THEME_EDITOR_ENABLED = 'true';

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');
const { issueReauthProof } = await import('../../src/middleware/recentAuth.js');

const TAG = 'dev-tokens-ct';
const emails = [`admin@${TAG}.test`, `organizer@${TAG}.test`, `outsider@${TAG}.test`];
const REDIRECT = 'http://127.0.0.1:53682/callback';
const bearer = (token) => ['Authorization', `Bearer ${token}`];

function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

describe('Developer tokens contract (043A)', () => {
  let organization;
  let other;
  let adminToken;
  let organizerToken;
  let outsiderToken;

  const reauth = (token) => ['X-Jump-Reauth', issueReauthProof(jwt.decode(token).sub).reauthToken];
  const authorize = (token, body) =>
    request(app)
      .post('/developer/authorize')
      .set(...bearer(token))
      .set(...reauth(token))
      .send({ store: organization.slug, redirectUri: REDIRECT, name: 'Jump CLI on test', ...body });
  const exchange = (body) => request(app).post('/developer/token').send({ redirectUri: REDIRECT, ...body });

  /** The whole CLI login: approve in the browser, trade the code. */
  async function login(token = organizerToken) {
    const { verifier, challenge } = pkce();
    const approved = await authorize(token, { codeChallenge: challenge });
    expect(approved.status).toBe(201);
    const res = await exchange({ code: approved.body.code, codeVerifier: verifier });
    expect(res.status).toBe(201);
    return res.body;
  }

  beforeAll(async () => {
    await prisma.organization.deleteMany({ where: { name: { startsWith: `${TAG} ` } } }).catch(() => {});
    adminToken = await staffToken({ email: emails[0], role: 'ADMIN' });
    organizerToken = await staffToken({ email: emails[1], role: 'ORGANIZER' });
    outsiderToken = await staffToken({ email: emails[2], role: 'ORGANIZER' });
    organization = await prisma.organization.create({ data: { name: `${TAG} Store`, slug: `${TAG}-store`, themesEnabled: true } });
    other = await prisma.organization.create({ data: { name: `${TAG} Other`, slug: `${TAG}-other`, themesEnabled: true } });
    await joinOrgByToken(adminToken, organization.id, 'ADMIN');
    await joinOrgByToken(organizerToken, organization.id, 'ORGANIZER');
    await joinOrgByToken(organizerToken, other.id, 'ORGANIZER');
    await joinOrgByToken(outsiderToken, other.id, 'ORGANIZER');
  });

  afterAll(async () => {
    await prisma.developerAuthCode.deleteMany({ where: { organizationId: { in: [organization.id, other.id] } } });
    await prisma.organization.deleteMany({ where: { id: { in: [organization.id, other.id] } } }).catch(() => {});
    await cleanupStaff(emails);
  });

  describe('browser approval', () => {
    it('names the store for members only', async () => {
      const ok = await request(app).get(`/developer/authorize?store=${organization.slug}`).set(...bearer(organizerToken));
      expect(ok.status).toBe(200);
      expect(ok.body.organization).toEqual({ id: organization.id, name: organization.name, slug: organization.slug });
      const outsider = await request(app).get(`/developer/authorize?store=${organization.slug}`).set(...bearer(outsiderToken));
      expect(outsider.status).toBe(403);
      const missing = await request(app).get('/developer/authorize?store=nope').set(...bearer(organizerToken));
      expect(missing.status).toBe(404);
    });

    it('needs a recent sign-in, a loopback redirect and a PKCE challenge', async () => {
      const { challenge } = pkce();
      const stale = await request(app)
        .post('/developer/authorize')
        .set(...bearer(organizerToken))
        .send({ store: organization.slug, redirectUri: REDIRECT, codeChallenge: challenge });
      expect(stale.status).toBe(401);
      expect(stale.body.code).toBe('REAUTH_REQUIRED');

      for (const redirectUri of ['https://evil.example/callback', 'http://127.0.0.1/callback', 'http://user:pw@127.0.0.1:1/x', 'nonsense']) {
        expect((await authorize(organizerToken, { codeChallenge: challenge, redirectUri })).status).toBe(400);
      }
      expect((await authorize(organizerToken, { codeChallenge: 'short' })).status).toBe(400);
      expect((await authorize(outsiderToken, { codeChallenge: challenge })).status).toBe(403);
    });
  });

  describe('code exchange', () => {
    it('trades code + verifier for a token once', async () => {
      const { verifier, challenge } = pkce();
      const { body } = await authorize(organizerToken, { codeChallenge: challenge });
      const res = await exchange({ code: body.code, codeVerifier: verifier });
      expect(res.status).toBe(201);
      expect(res.body.token).toMatch(/^jmp_[A-Za-z0-9_-]{43}$/);
      expect(res.body).toMatchObject({ scopes: ['themes'], organization: { id: organization.id }, user: { email: emails[1] } });
      const row = await prisma.developerToken.findFirst({ where: { organizationId: organization.id, prefix: res.body.token.slice(0, 10) } });
      expect(row.tokenHash).not.toContain(res.body.token);
      expect(row.name).toBe('Jump CLI on test');

      const again = await exchange({ code: body.code, codeVerifier: verifier });
      expect(again.status).toBe(401);
    });

    it('refuses a wrong verifier, a different redirect and an expired code', async () => {
      const first = pkce();
      const a = (await authorize(organizerToken, { codeChallenge: first.challenge })).body.code;
      expect((await exchange({ code: a, codeVerifier: pkce().verifier })).status).toBe(401);
      // A failed attempt burns the code: no second guess.
      expect((await exchange({ code: a, codeVerifier: first.verifier })).status).toBe(401);

      const b = (await authorize(organizerToken, { codeChallenge: first.challenge })).body.code;
      expect((await exchange({ code: b, codeVerifier: first.verifier, redirectUri: 'http://127.0.0.1:9/other' })).status).toBe(401);

      const c = (await authorize(organizerToken, { codeChallenge: first.challenge })).body.code;
      await prisma.developerAuthCode.updateMany({
        where: { codeHash: createHash('sha256').update(c).digest('hex') },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      expect((await exchange({ code: c, codeVerifier: first.verifier })).status).toBe(401);
    });

    it('a code is single use even when two exchanges race', async () => {
      const { verifier, challenge } = pkce();
      const { code } = (await authorize(organizerToken, { codeChallenge: challenge })).body;
      const results = await Promise.all([exchange({ code, codeVerifier: verifier }), exchange({ code, codeVerifier: verifier })]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 401]);
    });
  });

  describe('using the token', () => {
    it('works on /admin/themes for its own organization', async () => {
      const { token } = await login();
      const list = await request(app).get('/admin/themes').set(...bearer(token));
      expect(list.status).toBe(200);
      expect(list.body.themes[0]).toMatchObject({ role: 'MAIN' });
      const theme = list.body.themes[0];
      const saved = await request(app)
        .put(`/admin/themes/${theme.id}/save`)
        .set(...bearer(token))
        .send({ themeVersion: theme.version, documents: { home: { version: 0, data: { root: { props: {} }, content: [] } } } });
      expect(saved.status).toBe(200);
      // The revision is attributed to the developer.
      const revision = await prisma.themeRevision.findFirst({ where: { themeId: theme.id }, orderBy: { createdAt: 'desc' } });
      expect(revision.savedById).toBe(jwt.decode(organizerToken).sub);

      const me = await request(app).get('/developer/me').set(...bearer(token));
      expect(me.body).toMatchObject({ organizationId: organization.id, user: { email: emails[1] } });
    });

    it('is bound to its organization: X-Jump-Org cannot move it', async () => {
      // The organizer belongs to both organizations; the token was approved for one.
      const { token } = await login();
      const own = await prisma.theme.findFirst({ where: { organizationId: organization.id, role: 'MAIN' } });
      const res = await request(app).get('/admin/themes').set(...bearer(token)).set('X-Jump-Org', other.id);
      expect(res.status).toBe(200);
      expect(res.body.themes.map((t) => t.id)).toEqual([own.id]);
      expect(await prisma.theme.count({ where: { organizationId: other.id } })).toBe(0);
    });

    it('is refused everywhere else', async () => {
      const { token } = await login();
      for (const path of ['/admin/orders', '/admin/online-store/preferences', '/account', '/admin/files/some-id']) {
        const res = await request(app).get(path).set(...bearer(token));
        expect(res.status).toBe(401);
      }
    });

    it('lists and uploads files for its organization, and nothing more', async () => {
      const { token } = await login();
      const PNG = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64'
      );
      const uploaded = await request(app)
        .post('/admin/files')
        .set(...bearer(token))
        .set('X-Jump-Org', other.id)
        .attach('files', PNG, { filename: 'poster.png', contentType: 'image/png' });
      expect(uploaded.status).toBe(201);
      const [file] = uploaded.body.files;
      expect(file.organizationId).toBe(organization.id);

      const listed = await request(app).get('/admin/files').set(...bearer(token));
      expect(listed.status).toBe(200);
      expect(listed.body.files.map((f) => f.id)).toContain(file.id);

      const refused = [
        request(app).get(`/admin/files/${file.id}`).set(...bearer(token)),
        request(app).patch(`/admin/files/${file.id}`).set(...bearer(token)).send({ name: 'x' }),
        request(app).delete(`/admin/files/${file.id}`).set(...bearer(token)),
        request(app).post('/admin/files/from-url').set(...bearer(token)).send({ url: 'https://example.com/a.png' }),
      ];
      for (const res of await Promise.all(refused)) expect(res.status).toBe(401);
    });

    it('stops working once revoked, expired, or the member leaves', async () => {
      const revoked = await login();
      expect((await request(app).delete('/developer/token').set(...bearer(revoked.token))).status).toBe(204);
      const after = await request(app).get('/admin/themes').set(...bearer(revoked.token));
      expect(after.status).toBe(401);
      expect(after.body.code).toBe('DEVELOPER_TOKEN_INVALID');

      const expired = await login();
      await prisma.developerToken.updateMany({
        where: { prefix: expired.token.slice(0, 10) },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      expect((await request(app).get('/admin/themes').set(...bearer(expired.token))).status).toBe(401);

      const leaving = await login(adminToken);
      const adminId = jwt.decode(adminToken).sub;
      await prisma.organizationMember.delete({ where: { userId_organizationId: { userId: adminId, organizationId: organization.id } } });
      expect((await request(app).get('/admin/themes').set(...bearer(leaving.token))).status).toBe(401);
      await joinOrgByToken(adminToken, organization.id, 'ADMIN');
    });

    it('cannot change the theme rollout even for a system administrator', async () => {
      const systemToken = await staffToken({ email: `system@${TAG}.test`, role: 'SYSTEM_ADMIN' });
      const { token } = await login(systemToken);
      const res = await request(app).put('/admin/themes/rollout').set(...bearer(token)).send({ enabled: false });
      expect(res.status).toBe(403);
      await cleanupStaff([`system@${TAG}.test`]);
    });
  });

  describe('Settings › Developers', () => {
    it('admins see and revoke every token; organizers only their own', async () => {
      const mine = await login(organizerToken);
      const admins = await login(adminToken);
      const asAdmin = await request(app).get('/admin/developer-tokens').set(...bearer(adminToken)).set('X-Jump-Org', organization.id);
      expect(asAdmin.status).toBe(200);
      const prefixes = asAdmin.body.tokens.map((t) => t.prefix);
      expect(prefixes).toEqual(expect.arrayContaining([mine.token.slice(0, 10), admins.token.slice(0, 10)]));
      expect(JSON.stringify(asAdmin.body)).not.toContain(mine.token);

      const asOrganizer = await request(app).get('/admin/developer-tokens').set(...bearer(organizerToken)).set('X-Jump-Org', organization.id);
      expect(asOrganizer.body.tokens.every((t) => t.user.id === jwt.decode(organizerToken).sub)).toBe(true);

      const adminRow = asAdmin.body.tokens.find((t) => t.prefix === admins.token.slice(0, 10));
      const denied = await request(app)
        .delete(`/admin/developer-tokens/${adminRow.id}`)
        .set(...bearer(organizerToken))
        .set('X-Jump-Org', organization.id);
      expect(denied.status).toBe(404);

      const mineRow = asAdmin.body.tokens.find((t) => t.prefix === mine.token.slice(0, 10));
      const revoked = await request(app)
        .delete(`/admin/developer-tokens/${mineRow.id}`)
        .set(...bearer(adminToken))
        .set('X-Jump-Org', organization.id);
      expect(revoked.status).toBe(204);
      expect((await request(app).get('/admin/themes').set(...bearer(mine.token))).status).toBe(401);
    });
  });
});
