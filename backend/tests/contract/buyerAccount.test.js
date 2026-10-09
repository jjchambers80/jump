// Contract tests for the patron account (spec 040 card B): profile edits,
// verified email change, RSVPs, receipts, marketing preference, one-click
// unsubscribe and "sign out of all devices". Every route acts on the
// session's own Contact at one organization only.

import { jest } from '@jest/globals';
import request from 'supertest';

const sentEmails = [];
jest.unstable_mockModule('../../src/config/resend.js', () => ({
  default: { emails: { send: jest.fn(async (msg) => { sentEmails.push(msg); return { id: 'mock' }; }) } },
}));

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');
const { default: buyerAuthService } = await import('../../src/services/BuyerAuthService.js');
const { signUnsubscribeToken, listUnsubscribeHeaders } = await import('../../src/utils/unsubscribeToken.js');

const TAG = 'buyer-account-040';

async function createOrg(name) {
  const org = await prisma.organization.create({ data: { name } });
  const venue = await prisma.venue.create({
    data: { organizationId: org.id, name: `${name} Hall`, address: '1 St', timezone: 'America/New_York' },
  });
  const event = await prisma.event.create({
    data: { venueId: venue.id, name: `${name} Fair`, date: new Date(Date.now() + 7 * 86400000), capacity: 100, status: 'PUBLISHED' },
  });
  return { org, venue, event };
}

async function createBuyer(fixture, email, extra = {}) {
  const contact = await prisma.contact.create({
    data: { organizationId: fixture.org.id, email, firstName: 'Ada', lastName: 'Lovelace', accountCreatedAt: new Date(), ...extra },
  });
  const token = buyerAuthService.signSession({ contactId: contact.id, organizationId: fixture.org.id, email });
  return { contact, token, auth: { Authorization: `Bearer ${token}` } };
}

const lastEmailTo = (address) => [...sentEmails].reverse().find((m) => m.to?.includes(address));
const flush = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('Patron account (spec 040 card B)', () => {
  let A;
  let B;

  beforeAll(async () => {
    A = await createOrg(`${TAG} A`);
    B = await createOrg(`${TAG} B`);
  });

  afterAll(async () => {
    const orgIds = [A?.org.id, B?.org.id].filter(Boolean);
    const contactWhere = { organizationId: { in: orgIds } };
    await prisma.legalAcceptance.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.refund.deleteMany({ where: { order: { contact: contactWhere } } });
    await prisma.orderItem.deleteMany({ where: { order: { contact: contactWhere } } });
    await prisma.order.deleteMany({ where: { contact: contactWhere } });
    await prisma.eventRsvp.deleteMany({ where: { contact: contactWhere } });
    await prisma.contactComment.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.buyerLoginToken.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.contact.deleteMany({ where: contactWhere });
    await prisma.event.deleteMany({ where: { venue: { organizationId: { in: orgIds } } } });
    await prisma.venue.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  });

  describe('PATCH /buyer/me', () => {
    it('updates only whitelisted fields and notes the change on the timeline', async () => {
      const { contact, auth } = await createBuyer(A, `profile@${TAG}.test`);
      const res = await request(app).patch('/buyer/me').set(auth).send({ firstName: ' Grace ', phone: '+1 919 555 0100', location: '' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ firstName: 'Grace', lastName: 'Lovelace', phone: '+1 919 555 0100', location: null });

      const comment = await prisma.contactComment.findFirst({ where: { contactId: contact.id, kind: 'PROFILE_UPDATED' } });
      expect(comment).toMatchObject({ authorUserId: null });
      expect(comment.body).toBe('Customer updated their first name, phone');
    });

    it('refuses email, notes, tags and marketing through the profile PATCH', async () => {
      const { auth } = await createBuyer(A, `whitelist@${TAG}.test`);
      for (const body of [{ email: 'x@y.test' }, { note: 'vip' }, { tags: ['vip'] }, { emailSubscribed: true }]) {
        const res = await request(app).patch('/buyer/me').set(auth).send(body);
        expect(res.status).toBe(400);
      }
      expect((await request(app).patch('/buyer/me').set(auth).send({ firstName: '  ' })).status).toBe(400);
    });

    it('needs a buyer session', async () => {
      expect((await request(app).patch('/buyer/me').send({ firstName: 'X' })).status).toBe(401);
    });
  });

  describe('email change', () => {
    it('confirms from the link sent to the new address, then notices the old one', async () => {
      const oldEmail = `old@${TAG}.test`;
      const newEmail = `New@${TAG}.test`;
      const { contact, auth } = await createBuyer(A, oldEmail);

      const res = await request(app).post('/buyer/me/email').set(auth).send({ newEmail });
      expect(res.status).toBe(202);
      expect(res.body).toEqual({ pendingEmail: newEmail.toLowerCase() });
      await flush();

      const me = await request(app).get('/buyer/me').set(auth);
      expect(me.body).toMatchObject({ email: oldEmail, pendingEmail: newEmail.toLowerCase() });

      const confirmMail = lastEmailTo(newEmail.toLowerCase());
      const token = decodeURIComponent(String(confirmMail.html).match(/email-confirm\?token=([A-Za-z0-9_%-]+)/)[1]);
      expect(lastEmailTo(oldEmail).subject).toMatch(/Email change requested/);

      const confirm = await request(app).post('/buyer/me/email/confirm').send({ token });
      expect(confirm.status).toBe(200);
      expect(confirm.body).toEqual({ organizationId: A.org.id, email: newEmail.toLowerCase() });
      expect((await prisma.contact.findUnique({ where: { id: contact.id } })).email).toBe(newEmail.toLowerCase());
      await flush();
      expect(lastEmailTo(oldEmail).subject).toMatch(/was changed/);
      expect(await prisma.contactComment.count({ where: { contactId: contact.id, kind: 'EMAIL_CHANGED', authorUserId: null } })).toBe(1);

      // Single use
      expect((await request(app).post('/buyer/me/email/confirm').send({ token })).status).toBe(400);
    });

    it('409 EMAIL_IN_USE when another contact at this organization has the address; another org does not count', async () => {
      const taken = `taken@${TAG}.test`;
      await createBuyer(A, taken);
      await createBuyer(B, `elsewhere@${TAG}.test`);
      const { auth } = await createBuyer(A, `wants-taken@${TAG}.test`);

      const res = await request(app).post('/buyer/me/email').set(auth).send({ newEmail: taken });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('EMAIL_IN_USE');

      const ok = await request(app).post('/buyer/me/email').set(auth).send({ newEmail: `elsewhere@${TAG}.test` });
      expect(ok.status).toBe(202);
    });

    it('a newer request supersedes the older link, and DELETE withdraws the pending change', async () => {
      const { auth } = await createBuyer(A, `supersede@${TAG}.test`);
      await request(app).post('/buyer/me/email').set(auth).send({ newEmail: `first@${TAG}.test` });
      await flush();
      const firstToken = decodeURIComponent(String(lastEmailTo(`first@${TAG}.test`).html).match(/token=([A-Za-z0-9_%-]+)/)[1]);
      await request(app).post('/buyer/me/email').set(auth).send({ newEmail: `second@${TAG}.test` });
      expect((await request(app).post('/buyer/me/email/confirm').send({ token: firstToken })).status).toBe(400);

      const cancel = await request(app).delete('/buyer/me/email').set(auth);
      expect(cancel.body).toEqual({ pendingEmail: null });
      expect((await request(app).get('/buyer/me').set(auth)).body.pendingEmail).toBeNull();
    });
  });

  describe('RSVPs', () => {
    it('lists only the buyer’s own RSVPs with the venue zone and cancels by id', async () => {
      const { contact, auth } = await createBuyer(A, `rsvp@${TAG}.test`);
      const other = await createBuyer(A, `rsvp-other@${TAG}.test`);
      const mine = await prisma.eventRsvp.create({ data: { eventId: A.event.id, contactId: contact.id, partySize: 2 } });
      const theirs = await prisma.eventRsvp.create({ data: { eventId: A.event.id, contactId: other.contact.id } });

      const list = await request(app).get('/buyer/me/rsvps').set(auth);
      expect(list.status).toBe(200);
      expect(list.body.data).toHaveLength(1);
      expect(list.body.data[0]).toMatchObject({ id: mine.id, partySize: 2, status: 'GOING', event: { id: A.event.id, timezone: 'America/New_York' } });

      expect((await request(app).post(`/buyer/me/rsvps/${theirs.id}/cancel`).set(auth)).status).toBe(404);
      expect((await request(app).post(`/buyer/me/rsvps/${mine.id}/cancel`).set(auth)).status).toBe(200);
      expect((await prisma.eventRsvp.findUnique({ where: { id: mine.id } })).status).toBe('CANCELLED');
    });
  });

  describe('receipt', () => {
    it('returns amounts for the buyer’s paid order and 404 for anyone else’s or an unpaid one', async () => {
      const { contact, auth } = await createBuyer(A, `receipt@${TAG}.test`);
      const stranger = await createBuyer(A, `receipt-stranger@${TAG}.test`);
      const order = await prisma.order.create({
        data: {
          eventId: A.event.id,
          organizationId: contact.organizationId, contactId: contact.id,
          orderRef: `R040-${Date.now().toString(36).toUpperCase()}`,
          quantity: 2,
          subtotalAmount: 40,
          taxAmount: 2.9,
          totalAmount: 46.12,
          status: 'COMPLETED',
          paidAt: new Date(),
          items: { create: [{ description: 'GA', quantity: 2, unitPrice: 20 }] },
        },
      });
      const pending = await prisma.order.create({
        data: { eventId: A.event.id, organizationId: contact.organizationId, contactId: contact.id, orderRef: `P040-${Date.now().toString(36).toUpperCase()}`, quantity: 1, totalAmount: 10, status: 'PENDING' },
      });

      const res = await request(app).get(`/buyer/me/orders/${order.id}/receipt`).set(auth);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        orderRef: order.orderRef,
        organization: { name: A.org.name },
        event: { name: A.event.name, timezone: 'America/New_York' },
        lines: [{ description: 'GA', quantity: 2, unitPrice: 20, amount: 40 }],
        subtotal: 40,
        fees: 3.22,
        tax: 2.9,
        total: 46.12,
      });
      expect(JSON.stringify(res.body)).not.toMatch(/stripe/i);

      expect((await request(app).get(`/buyer/me/orders/${order.id}/receipt`).set(stranger.auth)).status).toBe(404);
      expect((await request(app).get(`/buyer/me/orders/${pending.id}/receipt`).set(auth)).status).toBe(404);
    });
  });

  describe('marketing preference', () => {
    it('opting in writes a MARKETING acceptance with the label shown; opting out stamps the unsubscribe', async () => {
      const { contact, auth } = await createBuyer(A, `prefs@${TAG}.test`);
      const me = await request(app).get('/buyer/me').set(auth);
      expect(me.body.marketingConsentText).toContain(A.org.name);

      const on = await request(app).patch('/buyer/me/preferences').set(auth).send({ emailSubscribed: true });
      expect(on.body).toEqual({ emailSubscribed: true });
      const subscribed = await prisma.contact.findUnique({ where: { id: contact.id } });
      expect(subscribed).toMatchObject({ emailSubscribed: true, emailSubscribedSource: 'ACCOUNT', emailUnsubscribedAt: null });
      const acceptance = await prisma.legalAcceptance.findFirst({ where: { subjectId: contact.id, document: 'MARKETING' } });
      expect(acceptance).toMatchObject({ source: 'ACCOUNT', subjectType: 'CONTACT', organizationId: A.org.id, presentedText: me.body.marketingConsentText });

      const off = await request(app).patch('/buyer/me/preferences').set(auth).send({ emailSubscribed: false });
      expect(off.body).toEqual({ emailSubscribed: false });
      const unsubscribed = await prisma.contact.findUnique({ where: { id: contact.id } });
      expect(unsubscribed.emailSubscribed).toBe(false);
      expect(unsubscribed.emailUnsubscribedAt).toBeInstanceOf(Date);
      expect(await prisma.legalAcceptance.count({ where: { subjectId: contact.id } })).toBe(1);
    });

    it('rejects anything but a boolean', async () => {
      const { auth } = await createBuyer(A, `prefs-bad@${TAG}.test`);
      expect((await request(app).patch('/buyer/me/preferences').set(auth).send({ emailSubscribed: 'yes' })).status).toBe(400);
      expect((await request(app).patch('/buyer/me/preferences').set(auth).send({ emailSubscribed: true, x: 1 })).status).toBe(400);
    });
  });

  describe('one-click unsubscribe', () => {
    it('GET describes, POST (RFC 8058 form post) unsubscribes, a forged token is 404', async () => {
      const { contact } = await createBuyer(A, `unsub@${TAG}.test`, { emailSubscribed: true, emailSubscribedAt: new Date(), emailSubscribedSource: 'CHECKOUT' });
      const t = signUnsubscribeToken(contact);

      const info = await request(app).get('/buyer/unsubscribe').query({ t });
      expect(info.status).toBe(200);
      expect(info.body).toMatchObject({ organization: { id: A.org.id }, emailSubscribed: true });
      expect(info.body.email).toMatch(/^u•+@buyer-account-040\.test$/);
      expect((await prisma.contact.findUnique({ where: { id: contact.id } })).emailSubscribed).toBe(true);

      const post = await request(app)
        .post(`/buyer/unsubscribe?t=${encodeURIComponent(t)}`)
        .type('form')
        .send('List-Unsubscribe=One-Click');
      expect(post.status).toBe(200);
      expect(post.body.emailSubscribed).toBe(false);
      expect((await prisma.contact.findUnique({ where: { id: contact.id } })).emailSubscribed).toBe(false);

      const forged = `${contact.id}.${'A'.repeat(43)}`;
      expect((await request(app).get('/buyer/unsubscribe').query({ t: forged })).status).toBe(404);
      expect((await request(app).get('/buyer/unsubscribe').query({ t: 'nonsense' })).status).toBe(404);
    });

    it('a token for one organization never works for another (the org is in the MAC)', async () => {
      const { contact } = await createBuyer(B, `unsub-b@${TAG}.test`);
      const wrongOrg = signUnsubscribeToken({ id: contact.id, organizationId: A.org.id });
      expect((await request(app).get('/buyer/unsubscribe').query({ t: wrongOrg })).status).toBe(404);
    });

    it('builds RFC 8058 headers', () => {
      const headers = listUnsubscribeHeaders({ id: 'c1', organizationId: 'o1' });
      expect(headers['List-Unsubscribe']).toMatch(/^<https?:\/\/.+\/buyer\/unsubscribe\?t=c1\..+>$/);
      expect(headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    });
  });

  describe('sign out of all devices', () => {
    it('refuses sessions issued before the cut-off and returns a working fresh one', async () => {
      const { contact } = await createBuyer(A, `revoke@${TAG}.test`);
      // Sessions minted a few seconds ago on "other devices".
      const past = new Date(Date.now() - 5000);
      const old = buyerAuthService.signSession({ contactId: contact.id, organizationId: A.org.id, email: contact.email }, { issuedAt: past });
      const other = buyerAuthService.signSession({ contactId: contact.id, organizationId: A.org.id, email: contact.email }, { issuedAt: past });

      const res = await request(app).post('/buyer/me/sessions/revoke-all').set({ Authorization: `Bearer ${old}` });
      expect(res.status).toBe(200);
      const fresh = res.body.sessionToken;

      const refused = await request(app).get('/buyer/me').set({ Authorization: `Bearer ${other}` });
      expect(refused.status).toBe(401);
      expect(refused.body.code).toBe('SESSION_REVOKED');
      expect((await request(app).get('/buyer/me').set({ Authorization: `Bearer ${old}` })).status).toBe(401);
      expect((await request(app).get('/buyer/me').set({ Authorization: `Bearer ${fresh}` })).status).toBe(200);
    });
  });
});
