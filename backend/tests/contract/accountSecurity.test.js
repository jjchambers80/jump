// Contract tests for sign-in methods (spec 030 B): step-up via emailed
// code, password set / sign-in / change signs out other devices / remove,
// provider disconnect, secondary email add → verify → recovery link →
// bridge token, and that every security mutation demands recent auth.

import { jest } from '@jest/globals';
import request from 'supertest';
import { staffToken, signToken, cleanupStaff } from '../helpers/staff.js';

const sentEmails = [];
jest.unstable_mockModule('../../src/config/resend.js', () => ({
  default: { emails: { send: jest.fn(async (msg) => { sentEmails.push(msg); return { id: 'mock' }; }) } },
}));

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');
const { hashToken } = await import('../../src/utils/oneTimeTokens.js');

const RUN = `${process.pid}-${Date.now()}`;
const TAG = `security-ct-${RUN}`;
const emails = [`me@${TAG}.test`, `other@${TAG}.test`];
const SECONDARY = `backup@${TAG}.test`;
const PASSWORD = 'a long and unbreached passphrase';
const auth = (token) => ['Authorization', `Bearer ${token}`];
const AUTH_SECRET = process.env.AUTH_SECRET;

const codeFrom = (msg) => String(msg.subject).match(/^(\d{6}) is your/)?.[1];
const linkToken = (msg, path) => {
  const m = String(msg.html).match(new RegExp(`${path}\\?token=([A-Za-z0-9_%-]+)`));
  return m ? decodeURIComponent(m[1]) : null;
};
const waitForEmails = async (n) => {
  for (let i = 0; i < 40 && sentEmails.length < n; i += 1) await new Promise((r) => setTimeout(r, 25));
};

async function reauthViaEmail(token) {
  sentEmails.length = 0;
  const start = await request(app).post('/account/reauth/start').set(...auth(token)).send({ method: 'email' }).expect(200);
  expect(start.body.methods).toContain('email');
  const code = codeFrom(sentEmails[0]);
  const res = await request(app).post('/account/reauth').set(...auth(token)).send({ code }).expect(200);
  return res.body.reauthToken;
}

describe('Account security contract', () => {
  let me;
  let token;
  let otherToken;
  process.env.HIBP_CHECK = 'false';

  beforeAll(async () => {
    token = await staffToken({ email: emails[0], role: 'ADMIN', name: 'Ada' });
    otherToken = await staffToken({ email: emails[1], role: 'ORGANIZER' });
    me = await prisma.user.findUnique({ where: { email: emails[0] } });
    await prisma.account.create({
      data: { userId: me.id, type: 'oauth', provider: 'google', providerAccountId: `g-${RUN}-123456`, access_token: 'ya29.secret' },
    });
  });

  afterAll(async () => {
    await cleanupStaff(emails);
  });

  it('security mutations require a recent-auth proof', async () => {
    for (const call of [
      request(app).post('/account/password').send({ password: PASSWORD }),
      request(app).delete('/account/password'),
      request(app).delete('/account/providers/google'),
      request(app).post('/account/secondary-email').send({ email: SECONDARY }),
      request(app).post('/account/email').send({ email: `new@${TAG}.test` }),
      request(app).post('/account/passkeys/register/options'),
    ]) {
      const res = await call.set(...auth(token)).expect(401);
      expect(res.body.code).toBe('REAUTH_REQUIRED');
    }
  });

  it('overview shows no secrets and lists the available step-up methods', async () => {
    const res = await request(app).get('/account/security').set(...auth(token)).expect(200);
    expect(res.body.password).toEqual({ set: false, updatedAt: null });
    expect(res.body.providers).toEqual([{ provider: 'google', accountIdHint: '…3456', connectedAt: expect.any(String) }]);
    expect(res.body.reauthMethods).toEqual(['email']);
    expect(JSON.stringify(res.body)).not.toMatch(/secret|Hash/);
  });

  it('a wrong step-up code is refused and logged; the emailed one works and the proof is user-bound', async () => {
    sentEmails.length = 0;
    await request(app).post('/account/reauth/start').set(...auth(token)).send({ method: 'email' }).expect(200);
    expect(sentEmails[0].to).toEqual([emails[0]]);
    const wrong = await request(app).post('/account/reauth').set(...auth(token)).send({ code: '000000' }).expect(401);
    expect(wrong.body.code).toBe('REAUTH_FAILED');
    const code = codeFrom(sentEmails[0]);
    const ok = await request(app).post('/account/reauth').set(...auth(token)).send({ code }).expect(200);
    expect(ok.body.reauthToken).toBeTruthy();
    // single use
    await request(app).post('/account/reauth').set(...auth(token)).send({ code }).expect(401);
    // not valid for another user
    const res = await request(app).post('/account/password').set(...auth(otherToken)).set('X-Jump-Reauth', ok.body.reauthToken).send({ password: PASSWORD }).expect(401);
    expect(res.body.code).toBe('REAUTH_REQUIRED');
  });

  it('sets a password (policy enforced), signs in with it, and change signs out other devices', async () => {
    const proof = await reauthViaEmail(token);
    const weak = await request(app).post('/account/password').set(...auth(token)).set('X-Jump-Reauth', proof).send({ password: 'short' }).expect(400);
    expect(weak.body.message).toMatch(/at least 12/);

    sentEmails.length = 0;
    const set = await request(app).post('/account/password').set(...auth(token)).set('X-Jump-Reauth', proof).send({ password: PASSWORD }).expect(200);
    expect(set.body.set).toBe(true);
    await waitForEmails(1);
    expect(sentEmails[0].subject).toMatch(/password was added/);

    // Frontend Credentials provider path
    await request(app).post('/auth/password').send({ email: emails[0], password: PASSWORD }).expect(401); // no internal key
    const signIn = await request(app).post('/auth/password').set('X-Jump-Internal', AUTH_SECRET).send({ email: emails[0].toUpperCase(), password: PASSWORD }).expect(200);
    expect(signIn.body).toEqual({ id: me.id, email: emails[0], name: 'Ada' });
    await request(app).post('/auth/password').set('X-Jump-Internal', AUTH_SECRET).send({ email: emails[0], password: 'wrong password here' }).expect(401);
    await request(app).post('/auth/password').set('X-Jump-Internal', AUTH_SECRET).send({ email: emails[1], password: PASSWORD }).expect(401); // no password set
    expect(await prisma.securityEvent.count({ where: { userId: me.id, type: 'SIGN_IN_FAILED' } })).toBeGreaterThanOrEqual(1);

    // Password now counts as a step-up method, and changing it revokes other sessions
    const overview = await request(app).get('/account/security').set(...auth(token)).expect(200);
    expect(overview.body.reauthMethods).toEqual(['password', 'email']);
    const mine = await prisma.userSession.create({ data: { userId: me.id } });
    const theirs = await prisma.userSession.create({ data: { userId: me.id } });
    const mineToken = signToken(me, { sid: mine.id });
    const theirsToken = signToken(me, { sid: theirs.id });
    const byPassword = await request(app).post('/account/reauth').set(...auth(mineToken)).send({ password: PASSWORD }).expect(200);
    const changed = await request(app).post('/account/password').set(...auth(mineToken)).set('X-Jump-Reauth', byPassword.body.reauthToken).send({ password: `${PASSWORD} v2` }).expect(200);
    expect(changed.body.otherDevicesSignedOut).toBeGreaterThanOrEqual(1);
    await request(app).get('/account').set(...auth(theirsToken)).expect(401);
    await request(app).get('/account').set(...auth(mineToken)).expect(200);

    // Remove
    await request(app).delete('/account/password').set(...auth(mineToken)).set('X-Jump-Reauth', byPassword.body.reauthToken).expect(200);
    await request(app).post('/auth/password').set('X-Jump-Internal', AUTH_SECRET).send({ email: emails[0], password: `${PASSWORD} v2` }).expect(401);
  });

  it('disconnects Google (best-effort revoke) and refuses an unknown provider', async () => {
    const proof = await reauthViaEmail(token);
    const originalFetch = global.fetch;
    const calls = [];
    global.fetch = async (url) => { calls.push(String(url)); return { ok: true }; };
    try {
      await request(app).delete('/account/providers/google').set(...auth(token)).set('X-Jump-Reauth', proof).expect(204);
    } finally {
      global.fetch = originalFetch;
    }
    expect(calls[0]).toMatch(/oauth2\.googleapis\.com\/revoke\?token=ya29\.secret/);
    expect(await prisma.account.count({ where: { userId: me.id } })).toBe(0);
    await request(app).delete('/account/providers/google').set(...auth(token)).set('X-Jump-Reauth', proof).expect(404);
    await request(app).delete('/account/providers/Bad%20Name').set(...auth(token)).set('X-Jump-Reauth', proof).expect(400);
  });

  it('secondary email: add → verify by link → recovery link → bridge token; remove', async () => {
    const proof = await reauthViaEmail(token);
    sentEmails.length = 0;
    const added = await request(app).post('/account/secondary-email').set(...auth(token)).set('X-Jump-Reauth', proof).send({ email: SECONDARY }).expect(200);
    expect(added.body).toEqual({ email: SECONDARY, verified: false });
    expect(sentEmails[0].to).toEqual([SECONDARY]);
    const verifyToken = linkToken(sentEmails[0], '/auth/confirm-secondary-email');

    // Not yet usable for recovery
    sentEmails.length = 0;
    await request(app).post('/auth/recover').send({ email: SECONDARY }).expect(200);
    expect(sentEmails).toHaveLength(0);

    const confirmed = await request(app).post('/account/secondary-email/confirm').send({ token: verifyToken }).expect(200);
    expect(confirmed.body.email).toBe(SECONDARY);
    await request(app).post('/account/secondary-email/confirm').send({ token: verifyToken }).expect(400);

    // Unknown addresses get the same 200 and no email
    sentEmails.length = 0;
    await request(app).post('/auth/recover').send({ email: `nobody@${TAG}.test` }).expect(200);
    expect(sentEmails).toHaveLength(0);

    await request(app).post('/auth/recover').send({ email: SECONDARY }).expect(200);
    expect(sentEmails[0].to).toEqual([SECONDARY]);
    const recoverToken = linkToken(sentEmails[0], '/auth/recover/complete');
    const done = await request(app).post('/auth/recover/complete').send({ token: recoverToken }).expect(200);
    const row = await prisma.verificationToken.findFirst({ where: { identifier: `bridge:${me.id}`, token: hashToken(done.body.bridgeToken) } });
    expect(row).toBeTruthy();
    await request(app).post('/auth/recover/complete').send({ token: recoverToken }).expect(401);

    // Notices now go to both addresses
    sentEmails.length = 0;
    const proof2 = await reauthViaEmail(token);
    sentEmails.length = 0;
    await request(app).post('/account/password').set(...auth(token)).set('X-Jump-Reauth', proof2).send({ password: PASSWORD }).expect(200);
    await waitForEmails(1);
    expect(sentEmails[0].to).toEqual([emails[0], SECONDARY]);

    await request(app).delete('/account/secondary-email').set(...auth(token)).set('X-Jump-Reauth', proof2).expect(204);
    const overview = await request(app).get('/account/security').set(...auth(token)).expect(200);
    expect(overview.body.secondaryEmail).toBeNull();
  });

  it('passkey registration options are per user and the sign-in options are public', async () => {
    const proof = await reauthViaEmail(token);
    const reg = await request(app).post('/account/passkeys/register/options').set(...auth(token)).set('X-Jump-Reauth', proof).expect(200);
    expect(reg.body.rp).toEqual({ name: 'Jump', id: 'localhost' });
    expect(reg.body.user.name).toBe(emails[0]);
    expect(reg.body.authenticatorSelection.residentKey).toBe('required');

    const login = await request(app).post('/auth/passkey/options').expect(200);
    expect(login.body.challengeId).toBeTruthy();
    expect(login.body.options.challenge).toBeTruthy();
    // A bogus assertion is refused
    const bad = await request(app).post('/auth/passkey/verify').send({ challengeId: login.body.challengeId, response: { id: 'nope', rawId: 'nope', response: {}, type: 'public-key' } }).expect(401);
    expect(bad.body.message).toMatch(/not recognized|expired/);
    // Same challenge cannot be reused
    await request(app).post('/auth/passkey/verify').send({ challengeId: login.body.challengeId, response: { id: 'nope', rawId: 'nope', response: {}, type: 'public-key' } }).expect(401);
    expect(await request(app).get('/account/passkeys').set(...auth(token)).expect(200).then((r) => r.body.passkeys)).toEqual([]);
  });
});
