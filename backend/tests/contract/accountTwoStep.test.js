// Contract tests for two-step authentication (spec 030 C): setup → enable
// (codes once, other devices out, proof for this browser), pending tokens
// blocked everywhere but the two-step router, verify by app code / recovery
// code (single use) / trusted device, lockout, regenerate, disable.

import { jest } from '@jest/globals';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { staffToken, signToken, cleanupStaff } from '../helpers/staff.js';

const sentEmails = [];
jest.unstable_mockModule('../../src/config/resend.js', () => ({
  default: { emails: { send: jest.fn(async (msg) => { sentEmails.push(msg); return { id: 'mock' }; }) } },
}));

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');
const { default: twoStepService } = await import('../../src/services/TwoStepService.js');
const { hashToken } = await import('../../src/utils/oneTimeTokens.js');

const RUN = `${process.pid}-${Date.now()}`;
const TAG = `two-step-ct-${RUN}`;
const emails = [`me@${TAG}.test`];
const auth = (token) => ['Authorization', `Bearer ${token}`];
const AUTH_SECRET = process.env.AUTH_SECRET;
const waitForEmails = async (n) => {
  for (let i = 0; i < 40 && sentEmails.length < n; i += 1) await new Promise((r) => setTimeout(r, 25));
};

async function reauthViaEmail(token) {
  sentEmails.length = 0;
  await request(app).post('/account/reauth/start').set(...auth(token)).send({ method: 'email' }).expect(200);
  const code = String(sentEmails[0].subject).match(/^(\d{6}) is your/)[1];
  const res = await request(app).post('/account/reauth').set(...auth(token)).send({ code }).expect(200);
  sentEmails.length = 0;
  return ['X-Jump-Reauth', res.body.reauthToken];
}

describe('Two-step authentication contract', () => {
  let me;
  let token;
  let proofHeader;
  let secret;
  let recoveryCodes;

  beforeAll(async () => {
    token = await staffToken({ email: emails[0], role: 'ADMIN', name: 'Ada' });
    me = await prisma.user.findUnique({ where: { email: emails[0] } });
  });

  afterAll(async () => {
    await cleanupStaff(emails);
  });

  it('status starts off; setup and enable need step-up', async () => {
    const status = await request(app).get('/account/two-step').set(...auth(token)).expect(200);
    expect(status.body).toMatchObject({ enabled: false, recoveryCodes: null, setupPending: false });
    await request(app).post('/account/two-step/setup').set(...auth(token)).expect(401);
    proofHeader = await reauthViaEmail(token);
  });

  it('setup returns a QR + secret; a wrong code does not enable; the right one does (codes once, proof, notice)', async () => {
    const setup = await request(app).post('/account/two-step/setup').set(...auth(token)).set(...proofHeader).expect(200);
    expect(setup.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\/Jump:/);
    expect(setup.body.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    secret = setup.body.secret;
    // Setup is idempotent until enabled
    const again = await request(app).post('/account/two-step/setup').set(...auth(token)).set(...proofHeader).expect(200);
    expect(again.body.secret).toBe(secret);
    expect((await request(app).get('/account/two-step').set(...auth(token))).body.setupPending).toBe(true);

    const wrong = await request(app).post('/account/two-step/enable').set(...auth(token)).set(...proofHeader).send({ code: '000000' }).expect(400);
    expect(wrong.body.code).toBe('CODE_INVALID');
    expect((await request(app).get('/account/two-step').set(...auth(token))).body.enabled).toBe(false);

    // Another device is signed in; enabling should sign it out
    const other = await prisma.userSession.create({ data: { userId: me.id } });
    const otherToken = signToken(me, { sid: other.id });
    await request(app).get('/account').set(...auth(otherToken)).expect(200);

    sentEmails.length = 0;
    const code = await twoStepService.currentCode(secret);
    const enabled = await request(app).post('/account/two-step/enable').set(...auth(token)).set(...proofHeader).send({ code }).expect(200);
    expect(enabled.body.recoveryCodes).toHaveLength(10);
    expect(enabled.body.recoveryCodes[0]).toMatch(/^[a-z0-9]{5}-[a-z0-9]{5}$/);
    expect(enabled.body.otherDevicesSignedOut).toBeGreaterThanOrEqual(1);
    const proof = jwt.verify(enabled.body.proof, AUTH_SECRET);
    expect(proof).toMatchObject({ typ: 'mfa', sub: me.id });
    expect(await prisma.verificationToken.findFirst({ where: { identifier: `mfa-proof:${proof.jti}`, token: hashToken(proof.jti) } })).toBeTruthy();
    recoveryCodes = enabled.body.recoveryCodes;
    await request(app).get('/account').set(...auth(otherToken)).expect(401);
    await waitForEmails(1);
    expect(sentEmails[0].subject).toMatch(/Two-step authentication is on/);

    const status = await request(app).get('/account/two-step').set(...auth(token)).expect(200);
    expect(status.body).toMatchObject({ enabled: true, methods: { app: true, securityKey: false }, recoveryCodes: { total: 10, remaining: 10 } });
    expect(JSON.stringify(status.body)).not.toMatch(new RegExp(secret));
  });

  it('a pending token reaches only the two-step router', async () => {
    const pending = signToken(me, { mfa: 'pending' });
    const refused = await request(app).get('/account').set(...auth(pending)).expect(401);
    expect(refused.body.code).toBe('TWO_STEP_REQUIRED');
    await request(app).get('/account/two-step').set(...auth(pending)).expect(401);
    await request(app).get('/organizations').set(...auth(pending)).expect(401);
    // pending-allowed endpoints answer
    const empty = await request(app).post('/account/two-step/verify').set(...auth(pending)).send({}).expect(400);
    expect(empty.body.message).toMatch(/authenticator code/);
    await request(app).post('/account/two-step/passkey-options').set(...auth(pending)).expect(200);
    const trusted = await request(app).post('/account/two-step/trusted-check').set(...auth(pending)).send({ token: 'nope' }).expect(200);
    expect(trusted.body.proof).toBeNull();
  });

  it('verify: app code → proof; recovery code single use with notice; remember device → trusted token', async () => {
    const pending = signToken(me, { mfa: 'pending' });
    const wrong = await request(app).post('/account/two-step/verify').set(...auth(pending)).send({ code: '000000' }).expect(401);
    expect(wrong.body.code).toBe('CODE_INVALID');

    const code = await twoStepService.currentCode(secret);
    const byApp = await request(app).post('/account/two-step/verify').set(...auth(pending)).send({ code, rememberDevice: true }).expect(200);
    expect(byApp.body.method).toBe('app');
    expect(jwt.verify(byApp.body.proof, AUTH_SECRET).typ).toBe('mfa');
    expect(byApp.body.trustToken).toBeTruthy();

    sentEmails.length = 0;
    const byRecovery = await request(app).post('/account/two-step/verify').set(...auth(pending)).send({ recoveryCode: recoveryCodes[0].toUpperCase() }).expect(200);
    expect(byRecovery.body.method).toBe('recovery');
    expect(byRecovery.body.trustToken).toBeUndefined();
    await waitForEmails(1);
    expect(sentEmails[0].subject).toMatch(/recovery code was used/);
    const reused = await request(app).post('/account/two-step/verify').set(...auth(pending)).send({ recoveryCode: recoveryCodes[0] }).expect(401);
    expect(reused.body.code).toBe('CODE_INVALID');
    expect((await request(app).get('/account/two-step').set(...auth(token))).body.recoveryCodes.remaining).toBe(9);

    // Trusted device completes without a code; someone else's token does not
    const trusted = await request(app).post('/account/two-step/trusted-check').set(...auth(pending)).send({ token: byApp.body.trustToken }).expect(200);
    expect(jwt.verify(trusted.body.proof, AUTH_SECRET).sub).toBe(me.id);
    const status = await request(app).get('/account/two-step').set(...auth(token)).expect(200);
    expect(status.body.trustedDevices).toHaveLength(1);
    await request(app).delete(`/account/two-step/trusted-devices/${status.body.trustedDevices[0].id}`).set(...auth(token)).set(...proofHeader).expect(204);
    expect((await request(app).post('/account/two-step/trusted-check').set(...auth(pending)).send({ token: byApp.body.trustToken })).body.proof).toBeNull();
  });

  it('locks after repeated failures', async () => {
    const pending = signToken(me, { mfa: 'pending' });
    await prisma.securityEvent.deleteMany({ where: { userId: me.id, type: 'TWO_STEP_FAILED' } });
    for (let i = 0; i < 5; i += 1) {
      await request(app).post('/account/two-step/verify').set(...auth(pending)).send({ code: '111111' }).expect(401);
    }
    const code = await twoStepService.currentCode(secret);
    const locked = await request(app).post('/account/two-step/verify').set(...auth(pending)).send({ code }).expect(401);
    expect(locked.body.code).toBe('TWO_STEP_LOCKED');
    await prisma.securityEvent.deleteMany({ where: { userId: me.id, type: 'TWO_STEP_FAILED' } });
  });

  it('regenerates recovery codes (old ones die) and disables with a current code', async () => {
    const regen = await request(app).post('/account/two-step/recovery-codes').set(...auth(token)).set(...proofHeader).expect(200);
    expect(regen.body.recoveryCodes).toHaveLength(10);
    expect(regen.body.recoveryCodes).not.toContain(recoveryCodes[1]);
    const pending = signToken(me, { mfa: 'pending' });
    await request(app).post('/account/two-step/verify').set(...auth(pending)).send({ recoveryCode: recoveryCodes[1] }).expect(401);

    await request(app).post('/account/two-step/disable').set(...auth(token)).set(...proofHeader).send({ code: '000000' }).expect(400);
    const code = await twoStepService.currentCode(secret);
    await request(app).post('/account/two-step/disable').set(...auth(token)).set(...proofHeader).send({ code }).expect(204);
    const status = await request(app).get('/account/two-step').set(...auth(token)).expect(200);
    expect(status.body).toMatchObject({ enabled: false, recoveryCodes: null, trustedDevices: [], setupPending: false });
    expect(await prisma.recoveryCode.count({ where: { userId: me.id } })).toBe(0);
    // With 2FA off, a stray pending token completes without a factor
    const stray = await request(app).post('/account/two-step/verify').set(...auth(pending)).send({ code: '123456' }).expect(200);
    expect(stray.body.method).toBeNull();
  });
});
