// Contract tests for the signed-in user's own account (spec 030 feature A).
//
// Covers: the subject is always the token's user, partial PATCH, the verified
// email change (pending → confirm → old address notified), uniqueness, expiry,
// photo upload/replace/remove, and that provider tokens never leak.

import { jest } from '@jest/globals';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import sharp from 'sharp';
import { staffToken, cleanupStaff } from '../helpers/staff.js';

const sentEmails = [];
jest.unstable_mockModule('../../src/config/resend.js', () => ({
  default: { emails: { send: jest.fn(async (msg) => { sentEmails.push(msg); return { id: 'mock' }; }) } },
}));

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');

const RUN = `${process.pid}-${Date.now()}`;
const TAG = `account-ct-${RUN}`;
const emails = [`me@${TAG}.test`, `other@${TAG}.test`];
const auth = (token) => ['Authorization', `Bearer ${token}`];

function tokenFromEmail(msg) {
  const m = String(msg.html).match(/confirm-email\?token=([A-Za-z0-9_%-]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

describe('Account contract', () => {
  let token;
  let userId;
  let otherToken;

  beforeAll(async () => {
    token = await staffToken({ email: emails[0], role: 'ORGANIZER', name: 'Test User' });
    otherToken = await staffToken({ email: emails[1], role: 'ADMIN' });
    userId = jwt.decode(token).sub;
    // A linked provider with secrets that must never be serialized
    await prisma.account.create({
      data: {
        userId,
        type: 'oauth',
        provider: 'google',
        providerAccountId: `google-${RUN}`,
        access_token: 'ya29.secret',
        refresh_token: '1//secret',
      },
    });
  });

  afterAll(async () => {
    await cleanupStaff(emails);
    await cleanupStaff([`renamed@${TAG}.test`, `taken@${TAG}.test`]);
  });

  beforeEach(() => {
    sentEmails.length = 0;
  });

  it('requires authentication', async () => {
    await request(app).get('/account').expect(401);
  });

  it('GET /account returns the profile and providers without tokens', async () => {
    const res = await request(app).get('/account').set(...auth(token)).expect(200);
    expect(res.body.email).toBe(emails[0]);
    expect(res.body.providers).toEqual([{ provider: 'google', connectedAt: expect.any(String) }]);
    expect(JSON.stringify(res.body)).not.toMatch(/secret/);
    expect(res.body.supportedLocales[0].code).toBe('en-US');
    expect(res.body.avatar).toBeNull();
  });

  it('PATCH /account updates only the supplied fields and rewrites name', async () => {
    const res = await request(app)
      .patch('/account')
      .set(...auth(token))
      .send({ firstName: 'Ada', lastName: 'Lovelace' })
      .expect(200);
    expect(res.body.name).toBe('Ada Lovelace');

    const phone = await request(app)
      .patch('/account')
      .set(...auth(token))
      .send({ phone: '919-555-0100', timeZone: 'America/New_York' })
      .expect(200);
    expect(phone.body.phone).toBe('+19195550100');
    expect(phone.body.timeZone).toBe('America/New_York');
    expect(phone.body.firstName).toBe('Ada');

    const removed = await request(app).patch('/account').set(...auth(token)).send({ phone: null }).expect(200);
    expect(removed.body.phone).toBeNull();
  });

  it('PATCH /account ignores another user: an id in the body is an unknown field', async () => {
    const otherId = jwt.decode(otherToken).sub;
    await request(app)
      .patch('/account')
      .set(...auth(token))
      .send({ id: otherId, firstName: 'Hijack' })
      .expect(400);
    const other = await prisma.user.findUnique({ where: { id: otherId } });
    expect(other.firstName).toBeNull();
  });

  it('PATCH /account rejects an unsupported locale', async () => {
    await request(app).patch('/account').set(...auth(token)).send({ locale: 'xx-XX' }).expect(400);
  });

  describe('email change', () => {
    it('refuses the current address and one another user holds', async () => {
      await request(app).post('/account/email').set(...auth(token)).send({ email: emails[0] }).expect(400);
      const res = await request(app).post('/account/email').set(...auth(token)).send({ email: emails[1] }).expect(409);
      expect(res.body.code).toBe('EMAIL_TAKEN');
      expect(sentEmails).toHaveLength(0);
    });

    it('goes pending, confirms from the emailed token, and notifies the old address', async () => {
      const newEmail = `renamed@${TAG}.test`;
      const pending = await request(app).post('/account/email').set(...auth(token)).send({ email: newEmail }).expect(200);
      expect(pending.body.pendingEmail).toBe(newEmail);
      expect(pending.body.email).toBe(emails[0]);
      expect(sentEmails).toHaveLength(1);
      expect(sentEmails[0].to).toEqual([newEmail]);
      const raw = tokenFromEmail(sentEmails[0]);
      expect(raw).toBeTruthy();

      // Confirm is public — no Authorization header
      const confirmed = await request(app).post('/account/email/confirm').send({ token: raw }).expect(200);
      expect(confirmed.body.email).toBe(newEmail);

      const user = await prisma.user.findUnique({ where: { id: userId } });
      expect(user.email).toBe(newEmail);
      expect(user.pendingEmail).toBeNull();
      expect(user.emailVerified).toBeInstanceOf(Date);
      expect(sentEmails[1].to).toEqual([emails[0]]);
      expect(sentEmails[1].subject).toMatch(/changed/);

      // Single use
      const reused = await request(app).post('/account/email/confirm').send({ token: raw }).expect(400);
      expect(reused.body.code).toBe('TOKEN_INVALID');

      // Put the address back for the remaining tests
      await prisma.user.update({ where: { id: userId }, data: { email: emails[0] } });
    });

    it('resend re-issues the token, cancel clears the pending state', async () => {
      const newEmail = `again@${TAG}.test`;
      await request(app).post('/account/email').set(...auth(token)).send({ email: newEmail }).expect(200);
      const first = tokenFromEmail(sentEmails[0]);
      await request(app).post('/account/email/resend').set(...auth(token)).expect(200);
      const second = tokenFromEmail(sentEmails[1]);
      expect(second).not.toBe(first);
      await request(app).post('/account/email/confirm').send({ token: first }).expect(400);

      const cancelled = await request(app).delete('/account/email/pending').set(...auth(token)).expect(200);
      expect(cancelled.body.pendingEmail).toBeNull();
      await request(app).post('/account/email/confirm').send({ token: second }).expect(400);
      await request(app).post('/account/email/resend').set(...auth(token)).expect(400);
    });

    it('rejects an expired token', async () => {
      const newEmail = `late@${TAG}.test`;
      await request(app).post('/account/email').set(...auth(token)).send({ email: newEmail }).expect(200);
      const raw = tokenFromEmail(sentEmails[0]);
      await prisma.verificationToken.updateMany({
        where: { identifier: `email-change:${userId}` },
        data: { expires: new Date(Date.now() - 1000) },
      });
      const res = await request(app).post('/account/email/confirm').send({ token: raw }).expect(400);
      expect(res.body.code).toBe('TOKEN_EXPIRED');
      await request(app).delete('/account/email/pending').set(...auth(token)).expect(200);
    });

    it('re-checks uniqueness at confirmation time', async () => {
      const contested = `taken@${TAG}.test`;
      await request(app).post('/account/email').set(...auth(token)).send({ email: contested }).expect(200);
      const raw = tokenFromEmail(sentEmails[0]);
      const squatter = await prisma.user.create({ data: { email: contested, role: 'UNASSIGNED' } });
      const res = await request(app).post('/account/email/confirm').send({ token: raw }).expect(409);
      expect(res.body.code).toBe('EMAIL_TAKEN');
      await prisma.user.delete({ where: { id: squatter.id } });
      await request(app).delete('/account/email/pending').set(...auth(token)).expect(200);
    });
  });

  describe('photo', () => {
    const png = (color) =>
      sharp({ create: { width: 16, height: 16, channels: 3, background: color } }).png().toBuffer();

    it('uploads, replaces (deleting the old image) and removes', async () => {
      const first = await request(app)
        .post('/account/avatar')
        .set(...auth(token))
        .attach('avatar', await png('#ff0000'), 'me.png')
        .expect(200);
      expect(first.body.avatar.usageType).toBe('avatar');
      expect(first.body.avatar.urls.thumb).toMatch(/\/images\//);
      const firstImageId = first.body.avatar.id;

      const second = await request(app)
        .post('/account/avatar')
        .set(...auth(token))
        .attach('avatar', await png('#00ff00'), 'me2.png')
        .expect(200);
      expect(second.body.avatar.id).not.toBe(firstImageId);
      expect(await prisma.image.findUnique({ where: { id: firstImageId } })).toBeNull();

      const removed = await request(app).delete('/account/avatar').set(...auth(token)).expect(200);
      expect(removed.body.avatar).toBeNull();
      expect(await prisma.image.findUnique({ where: { id: second.body.avatar.id } })).toBeNull();
    });

    it('rejects a non-image and an empty upload', async () => {
      await request(app)
        .post('/account/avatar')
        .set(...auth(token))
        .attach('avatar', Buffer.from('not an image'), { filename: 'x.png', contentType: 'image/png' })
        .expect(400);
      await request(app).post('/account/avatar').set(...auth(token)).expect(400);
    });
  });
});
