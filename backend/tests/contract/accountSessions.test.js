// Contract tests for Devices (spec 030 D): a token with `sid` is refused the
// moment its session is revoked; the list shows the current device first;
// "log out all other devices" keeps the current one; foreign sessions 404.

import { jest } from '@jest/globals';
import request from 'supertest';
import { staffToken, signToken, cleanupStaff } from '../helpers/staff.js';

const sentEmails = [];
jest.unstable_mockModule('../../src/config/resend.js', () => ({
  default: { emails: { send: jest.fn(async (msg) => { sentEmails.push(msg); return { id: 'mock' }; }) } },
}));

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');

const RUN = `${process.pid}-${Date.now()}`;
const TAG = `sessions-ct-${RUN}`;
const emails = [`me@${TAG}.test`, `other@${TAG}.test`];
const auth = (token) => ['Authorization', `Bearer ${token}`];
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

async function sessionFor(user, provider = 'google') {
  const row = await prisma.userSession.create({ data: { userId: user.id, provider } });
  return { sid: row.id, token: signToken(user, { sid: row.id }) };
}

describe('Devices contract', () => {
  let me;
  let other;
  let legacyToken;

  beforeAll(async () => {
    legacyToken = await staffToken({ email: emails[0], role: 'ORGANIZER' });
    await staffToken({ email: emails[1], role: 'ORGANIZER' });
    me = await prisma.user.findUnique({ where: { email: emails[0] } });
    other = await prisma.user.findUnique({ where: { email: emails[1] } });
  });

  afterAll(async () => {
    await cleanupStaff(emails);
  });

  it('a legacy token without sid still authenticates', async () => {
    await request(app).get('/account').set(...auth(legacyToken)).expect(200);
  });

  it('lists active sessions with the current one first and device labels from the UA', async () => {
    const a = await sessionFor(me, 'google');
    const b = await sessionFor(me, 'resend');
    // touch from a request so UA parsing lands on row b
    await request(app).get('/account').set(...auth(b.token)).set('User-Agent', UA).expect(200);
    await new Promise((r) => setTimeout(r, 150));

    const res = await request(app).get('/account/sessions').set(...auth(a.token)).expect(200);
    const ids = res.body.sessions.map((s) => s.id);
    expect(ids[0]).toBe(a.sid);
    expect(ids).toContain(b.sid);
    const rowB = res.body.sessions.find((s) => s.id === b.sid);
    expect(rowB.current).toBe(false);
    expect(rowB.device.label).toBe('macOS · Chrome');
    expect(rowB.location).toBeNull(); // GEOIP off → "Location unavailable"
    expect(JSON.stringify(res.body)).not.toMatch(/ipHash|127\.0\.0\.1/);
  });

  it('revoking another device refuses its token immediately and keeps mine', async () => {
    const mine = await sessionFor(me);
    const theirs = await sessionFor(me);
    await request(app).get('/account').set(...auth(theirs.token)).expect(200);

    await request(app).delete(`/account/sessions/${theirs.sid}`).set(...auth(mine.token)).expect(200);

    const refused = await request(app).get('/account').set(...auth(theirs.token)).expect(401);
    expect(refused.body.code).toBe('SESSION_REVOKED');
    await request(app).get('/account').set(...auth(mine.token)).expect(200);

    const list = await request(app).get('/account/sessions').set(...auth(mine.token)).expect(200);
    expect(list.body.sessions.map((s) => s.id)).not.toContain(theirs.sid);
    const event = await prisma.securityEvent.findFirst({ where: { userId: me.id, type: 'SESSION_REVOKED' } });
    expect(event).toBeTruthy();
  });

  it('log out all other devices keeps the current session and notifies', async () => {
    sentEmails.length = 0;
    const mine = await sessionFor(me);
    const s1 = await sessionFor(me);
    const s2 = await sessionFor(me);
    const res = await request(app).post('/account/sessions/revoke-others').set(...auth(mine.token)).expect(200);
    expect(res.body.revoked).toBeGreaterThanOrEqual(2);
    await request(app).get('/account').set(...auth(s1.token)).expect(401);
    await request(app).get('/account').set(...auth(s2.token)).expect(401);
    await request(app).get('/account').set(...auth(mine.token)).expect(200);
    // The notice is fire-and-forget; give the mock a tick.
    for (let i = 0; i < 20 && sentEmails.length === 0; i += 1) await new Promise((r) => setTimeout(r, 25));
    expect(sentEmails[0].to).toEqual([emails[0]]);
    expect(sentEmails[0].subject).toMatch(/logged out/);
  });

  it("another user's session id is 404 and stays active", async () => {
    const mine = await sessionFor(me);
    const foreign = await sessionFor(other);
    await request(app).delete(`/account/sessions/${foreign.sid}`).set(...auth(mine.token)).expect(404);
    await request(app).get('/account').set(...auth(foreign.token)).expect(200);
  });

  it('revoking the current device signs it out too', async () => {
    const mine = await sessionFor(me);
    const res = await request(app).delete(`/account/sessions/${mine.sid}`).set(...auth(mine.token)).expect(200);
    expect(res.body.current).toBe(true);
    await request(app).get('/account').set(...auth(mine.token)).expect(401);
  });

  it('a token whose session row no longer exists is refused', async () => {
    const token = signToken(me, { sid: 'clsessiondoesnotexist0000' });
    await request(app).get('/account').set(...auth(token)).expect(401);
  });
});
