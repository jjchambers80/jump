// Contract tests for "Delete my data" (spec 040 card D): preview, blockers,
// the emailed code, the grace period, cancel, the sweep that anonymizes
// (tickets voided with no refund and their seats back on sale, ledger kept),
// the Stripe Customer deleted, and the staff "Anonymize" action.

import { jest } from '@jest/globals';
import request from 'supertest';

const sentEmails = [];
jest.unstable_mockModule('../../src/config/resend.js', () => ({
  default: { emails: { send: jest.fn(async (msg) => { sentEmails.push(msg); return { id: 'mock' }; }) } },
}));
const deletedCustomers = [];
jest.unstable_mockModule('../../src/config/stripe.js', () => ({
  default: {
    customers: { del: jest.fn(async (id) => { deletedCustomers.push(id); return { id, deleted: true }; }) },
    checkout: { sessions: { expire: jest.fn(async () => ({})) } },
  },
}));

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');
const { default: buyerAuthService } = await import('../../src/services/BuyerAuthService.js');
const { default: contactErasureService, anonymizedContactData, suppressionHash } = await import('../../src/services/ContactErasureService.js');
const { issueReauthProof } = await import('../../src/middleware/recentAuth.js');
const { staffToken, joinOrgByToken, cleanupStaff } = await import('../helpers/staff.js');
const jwt = (await import('jsonwebtoken')).default;

const TAG = 'erasure-040';
const staffEmails = [`admin@${TAG}.test`, `organizer@${TAG}.test`];
const DAY = 86400000;
let seq = 0;

async function createOrg(name) {
  const org = await prisma.organization.create({ data: { name } });
  const venue = await prisma.venue.create({ data: { organizationId: org.id, name: `${name} Hall`, address: '1 St', timezone: 'America/New_York' } });
  const upcoming = await prisma.event.create({ data: { venueId: venue.id, name: `${name} Upcoming`, date: new Date(Date.now() + 10 * DAY), capacity: 100, status: 'PUBLISHED' } });
  const past = await prisma.event.create({ data: { venueId: venue.id, name: `${name} Past`, date: new Date(Date.now() - 10 * DAY), capacity: 100, status: 'PUBLISHED' } });
  const tier = await prisma.priceTier.create({ data: { eventId: upcoming.id, name: 'GA', price: 20, quantityTotal: 50, quantitySold: 5 } });
  const pastTier = await prisma.priceTier.create({ data: { eventId: past.id, name: 'GA', price: 20, quantityTotal: 50, quantitySold: 5 } });
  const form = await prisma.applicationForm.create({ data: { eventId: upcoming.id, kind: 'FREE', name: 'Press', slug: `press-${Date.now()}-${seq++}` } });
  return { org, venue, upcoming, past, tier, pastTier, form };
}

/** A buyer with a paid order (one upcoming ticket, one past), an RSVP, a submitted application and a note. */
async function seedBuyer(f, { email, stripeCustomerId = null } = {}) {
  const n = seq++;
  const contact = await prisma.contact.create({
    data: { organizationId: f.org.id, email, firstName: 'Ada', lastName: 'Lovelace', phone: '+19195550100', location: 'Raleigh', note: 'VIP', tags: ['vip'], accountCreatedAt: new Date(), emailSubscribed: true, emailSubscribedAt: new Date(), emailSubscribedSource: 'CHECKOUT', stripeCustomerId },
  });
  const order = await prisma.order.create({
    data: {
      eventId: f.upcoming.id, contactId: contact.id, orderRef: `E040-${n}-${Date.now().toString(36).toUpperCase()}`, quantity: 1,
      subtotalAmount: 20, totalAmount: 22.5, status: 'COMPLETED', paidAt: new Date(),
      items: { create: [{ priceTierId: f.tier.id, description: 'GA', quantity: 1, unitPrice: 20 }] },
      payment: { create: { amount: 22.5, currency: 'usd', status: 'SUCCEEDED' } },
    },
  });
  const pastOrder = await prisma.order.create({
    data: { eventId: f.past.id, contactId: contact.id, orderRef: `P040-${n}-${Date.now().toString(36).toUpperCase()}`, quantity: 1, subtotalAmount: 20, totalAmount: 22.5, status: 'COMPLETED', paidAt: new Date() },
  });
  const upcomingTicket = await prisma.ticket.create({ data: { orderId: order.id, eventId: f.upcoming.id, priceTierId: f.tier.id, contactId: contact.id, ticketNumber: 100 + n, pricePaid: 20, barcode: `${TAG}-u-${n}-${Date.now()}`, qrCodeJwt: 'jump://qr' } });
  const pastTicket = await prisma.ticket.create({ data: { orderId: pastOrder.id, eventId: f.past.id, priceTierId: f.pastTier.id, contactId: contact.id, ticketNumber: 100 + n, pricePaid: 20, barcode: `${TAG}-p-${n}-${Date.now()}`, qrCodeJwt: 'jump://qr2' } });
  const rsvp = await prisma.eventRsvp.create({ data: { eventId: f.upcoming.id, contactId: contact.id } });
  const profile = await prisma.applicantProfile.create({ data: { organizationId: f.org.id, contactId: contact.id, businessName: 'Ada Press', website: 'https://ada.example' } });
  const application = await prisma.application.create({
    data: { formId: f.form.id, eventId: f.upcoming.id, organizationId: f.org.id, contactId: contact.id, profileId: profile.id, status: 'SUBMITTED', submittedAt: new Date(), statusTokenHash: `${TAG}-${n}-${Date.now()}` },
  });
  await prisma.contactComment.create({ data: { contactId: contact.id, organizationId: f.org.id, authorUserId: null, kind: 'EMAIL_CHANGED', body: `Customer changed their email from old@${TAG}.test to ${email}` } });
  const token = buyerAuthService.signSession({ contactId: contact.id, organizationId: f.org.id, email }, { issuedAt: new Date(Date.now() - 5000) });
  return { contact, order, pastOrder, upcomingTicket, pastTicket, rsvp, application, auth: { Authorization: `Bearer ${token}` } };
}

const codeFor = (email) => {
  const msg = [...sentEmails].reverse().find((m) => m.to?.includes(email) && /confirms deleting/.test(m.subject));
  return msg?.subject.match(/^(\d{6})/)?.[1];
};

describe('Delete my data (spec 040 card D)', () => {
  let F;
  let G;
  let adminToken;
  let organizerToken;

  beforeAll(async () => {
    F = await createOrg(`${TAG} A`);
    G = await createOrg(`${TAG} B`);
    adminToken = await staffToken({ email: staffEmails[0], role: 'ADMIN' });
    organizerToken = await staffToken({ email: staffEmails[1], role: 'ORGANIZER' });
    await joinOrgByToken(adminToken, F.org.id, 'ADMIN');
    await joinOrgByToken(organizerToken, F.org.id, 'ORGANIZER');
  });

  afterEach(() => {
    delete process.env.ERASURE_GRACE_DAYS;
  });

  afterAll(async () => {
    const orgIds = [F?.org.id, G?.org.id].filter(Boolean);
    const contactWhere = { organizationId: { in: orgIds } };
    await prisma.erasureSuppression.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.applicationDecision.deleteMany({ where: { application: { organizationId: { in: orgIds } } } });
    await prisma.application.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.applicantProfile.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.applicationForm.deleteMany({ where: { event: { venue: { organizationId: { in: orgIds } } } } });
    await prisma.ticket.deleteMany({ where: { contact: contactWhere } });
    await prisma.paymentTransaction.deleteMany({ where: { order: { contact: contactWhere } } });
    await prisma.orderItem.deleteMany({ where: { order: { contact: contactWhere } } });
    await prisma.order.deleteMany({ where: { contact: contactWhere } });
    await prisma.eventRsvp.deleteMany({ where: { contact: contactWhere } });
    await prisma.contactComment.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.buyerLoginToken.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.contact.deleteMany({ where: contactWhere });
    await prisma.priceTier.deleteMany({ where: { event: { venue: { organizationId: { in: orgIds } } } } });
    await prisma.event.deleteMany({ where: { venue: { organizationId: { in: orgIds } } } });
    await prisma.venue.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.organizationMember.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    await cleanupStaff(staffEmails);
  });

  it('previews what would happen: upcoming tickets only, open applications, upcoming RSVPs, no blockers', async () => {
    const b = await seedBuyer(F, { email: `preview@${TAG}.test` });
    const res = await request(app).get('/buyer/me/erasure').set(b.auth);
    expect(res.status).toBe(200);
    expect(res.body.ticketsToVoid.map((t) => t.id)).toEqual([b.upcomingTicket.id]);
    expect(res.body.ticketsToVoid[0]).toMatchObject({ eventTimezone: 'America/New_York' });
    expect(res.body.applicationsToWithdraw.map((a) => a.id)).toEqual([b.application.id]);
    expect(res.body.rsvpsToCancel.map((r) => r.id)).toEqual([b.rsvp.id]);
    expect(res.body.blockers).toEqual([]);
    expect(res.body.graceDays).toBe(7);
  });

  it('money in flight or an approved application blocks the request with the reasons', async () => {
    const b = await seedBuyer(F, { email: `blocked@${TAG}.test` });
    await prisma.order.create({ data: { eventId: F.upcoming.id, contactId: b.contact.id, orderRef: `B040-${Date.now().toString(36).toUpperCase()}`, quantity: 1, totalAmount: 20, status: 'PENDING' } });
    await prisma.application.update({ where: { id: b.application.id }, data: { status: 'APPROVED' } });
    const res = await request(app).post('/buyer/me/erasure/request').set(b.auth);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ERASURE_BLOCKED');
    expect(res.body.details.blockers.map((x) => x.code).sort()).toEqual(['APPROVED_APPLICATION', 'PENDING_ORDER']);
  });

  it('the emailed code schedules erasure after the grace period; a wrong code does not; cancel clears it', async () => {
    const email = `schedule@${TAG}.test`;
    const b = await seedBuyer(F, { email });
    expect((await request(app).post('/buyer/me/erasure/request').set(b.auth)).status).toBe(202);
    await new Promise((r) => setTimeout(r, 20));
    const code = codeFor(email);
    expect(code).toMatch(/^\d{6}$/);

    const wrong = await request(app).post('/buyer/me/erasure/confirm').set(b.auth).send({ code: code === '000000' ? '111111' : '000000' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.code).toBe('CODE_INVALID');

    const ok = await request(app).post('/buyer/me/erasure/confirm').set(b.auth).send({ code });
    expect(ok.status).toBe(200);
    const scheduled = new Date(ok.body.scheduledFor).getTime();
    expect(scheduled).toBeGreaterThan(Date.now() + 6.9 * DAY);
    expect((await request(app).get('/buyer/me').set(b.auth)).body.erasureScheduledAt).toBeTruthy();
    // The code is single use.
    expect((await request(app).post('/buyer/me/erasure/confirm').set(b.auth).send({ code })).status).toBe(400);

    const cancelled = await request(app).delete('/buyer/me/erasure').set(b.auth);
    expect(cancelled.body).toEqual({ scheduledFor: null });
    expect((await prisma.contact.findUnique({ where: { id: b.contact.id } })).erasureScheduledAt).toBeNull();
  });

  it('the sweep anonymizes: tickets voided and back on sale, ledger kept, applications withdrawn, sessions dead, Stripe Customer deleted', async () => {
    process.env.ERASURE_GRACE_DAYS = '0';
    const email = `erase@${TAG}.test`;
    const b = await seedBuyer(F, { email, stripeCustomerId: `cus_${TAG}_${Date.now()}` });
    const other = await seedBuyer(G, { email }); // same email at another organization
    const soldBefore = (await prisma.priceTier.findUnique({ where: { id: F.tier.id } })).quantitySold;
    const pastSoldBefore = (await prisma.priceTier.findUnique({ where: { id: F.pastTier.id } })).quantitySold;

    await request(app).post('/buyer/me/erasure/request').set(b.auth);
    await new Promise((r) => setTimeout(r, 20));
    await request(app).post('/buyer/me/erasure/confirm').set(b.auth).send({ code: codeFor(email) });

    const result = await contactErasureService.sweep({ now: new Date(Date.now() + 1000) });
    expect(result.erased).toBeGreaterThanOrEqual(1);

    const contact = await prisma.contact.findUnique({ where: { id: b.contact.id } });
    expect(contact).toMatchObject({
      firstName: 'Deleted', lastName: 'User', phone: null, location: null, note: null, tags: [],
      emailSubscribed: false, accountCreatedAt: null, stripeCustomerId: null, erasureScheduledAt: null,
    });
    expect(contact.email).toMatch(/^deleted-.{8}@anonymized\.invalid$/);
    expect(contact.anonymizedAt).toBeInstanceOf(Date);
    expect(deletedCustomers).toContain(b.contact.stripeCustomerId);

    expect((await prisma.ticket.findUnique({ where: { id: b.upcomingTicket.id } })).status).toBe('VOIDED');
    expect((await prisma.ticket.findUnique({ where: { id: b.pastTicket.id } })).status).toBe('VALID');
    expect((await prisma.ticket.findUnique({ where: { id: b.pastTicket.id } })).qrCodeJwt).toBeNull();
    expect((await prisma.priceTier.findUnique({ where: { id: F.tier.id } })).quantitySold).toBe(soldBefore - 1);
    expect((await prisma.priceTier.findUnique({ where: { id: F.pastTier.id } })).quantitySold).toBe(pastSoldBefore);

    // The ledger is untouched: same totals, same status, no refund rows.
    const order = await prisma.order.findUnique({ where: { id: b.order.id }, include: { refunds: true } });
    expect(order).toMatchObject({ status: 'COMPLETED', contactId: b.contact.id });
    expect(Number(order.totalAmount)).toBe(22.5);
    expect(order.refunds).toHaveLength(0);

    expect((await prisma.application.findUnique({ where: { id: b.application.id } })).status).toBe('WITHDRAWN');
    expect((await prisma.eventRsvp.findUnique({ where: { id: b.rsvp.id } })).status).toBe('CANCELLED');
    expect((await prisma.applicantProfile.findFirst({ where: { contactId: b.contact.id } })).businessName).toBe('Deleted');

    const comments = await prisma.contactComment.findMany({ where: { contactId: b.contact.id } });
    expect(comments.map((c) => c.kind)).toEqual(['ANONYMIZED']);
    expect(JSON.stringify(comments)).not.toContain(email);

    expect(await prisma.erasureSuppression.count({ where: { organizationId: F.org.id, emailHash: suppressionHash(email) } })).toBe(1);
    expect(await prisma.buyerLoginToken.count({ where: { contactId: b.contact.id } })).toBe(0);

    // Old sessions are dead and the address no longer signs in.
    expect((await request(app).get('/buyer/me').set(b.auth)).status).toBe(401);
    const signIn = await buyerAuthService.requestLogin(F.org.id, email);
    expect(signIn.issued).toBe(false);

    // The final email went to the address the buyer had.
    expect(sentEmails.some((m) => m.to.includes(email) && /has been deleted/.test(m.subject))).toBe(true);

    // The same email at the other organization is untouched.
    const untouched = await prisma.contact.findUnique({ where: { id: other.contact.id } });
    expect(untouched).toMatchObject({ email, firstName: 'Ada', anonymizedAt: null });
    expect((await prisma.ticket.findUnique({ where: { id: other.upcomingTicket.id } })).status).toBe('VALID');
  });

  it('a blocker that appears during the grace period postpones the sweep by a day', async () => {
    const b = await seedBuyer(F, { email: `postpone@${TAG}.test` });
    await prisma.contact.update({ where: { id: b.contact.id }, data: { erasureScheduledAt: new Date(Date.now() - 1000) } });
    await prisma.order.create({ data: { eventId: F.upcoming.id, contactId: b.contact.id, orderRef: `Q040-${Date.now().toString(36).toUpperCase()}`, quantity: 1, totalAmount: 20, status: 'PENDING' } });
    await contactErasureService.sweep();
    const contact = await prisma.contact.findUnique({ where: { id: b.contact.id } });
    expect(contact.anonymizedAt).toBeNull();
    expect(contact.erasureScheduledAt.getTime()).toBeGreaterThan(Date.now() + 0.9 * DAY);
    expect((await prisma.ticket.findUnique({ where: { id: b.upcomingTicket.id } })).status).toBe('VALID');
  });

  it('staff anonymize: ADMIN with a fresh step-up proof erases at once; without the proof 401; ORGANIZER 403', async () => {
    const b = await seedBuyer(F, { email: `staff@${TAG}.test` });
    const adminId = jwt.decode(adminToken).sub;

    const preview = await request(app).get(`/admin/customers/${b.contact.id}/erasure`).set('Authorization', `Bearer ${adminToken}`);
    expect(preview.status).toBe(200);
    expect(preview.body.ticketsToVoid).toHaveLength(1);

    const noProof = await request(app).post(`/admin/customers/${b.contact.id}/anonymize`).set('Authorization', `Bearer ${adminToken}`);
    expect(noProof.status).toBe(401);
    expect(noProof.body.code).toBe('REAUTH_REQUIRED');

    const organizer = await request(app).post(`/admin/customers/${b.contact.id}/anonymize`).set('Authorization', `Bearer ${organizerToken}`);
    expect(organizer.status).toBe(403);

    const ok = await request(app)
      .post(`/admin/customers/${b.contact.id}/anonymize`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Jump-Reauth', issueReauthProof(adminId).reauthToken);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ status: 'erased', voidedTickets: 1 });
    const line = await prisma.contactComment.findFirst({ where: { contactId: b.contact.id, kind: 'ANONYMIZED' } });
    expect(line.authorUserId).toBe(adminId);

    const again = await request(app)
      .post(`/admin/customers/${b.contact.id}/anonymize`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Jump-Reauth', issueReauthProof(adminId).reauthToken);
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('ALREADY_ERASED');
  });

  it('anonymizedContactData and suppressionHash', () => {
    const now = new Date('2026-09-30T00:00:00Z');
    const data = anonymizedContactData({ id: 'cabcdefgh12345678', emailSubscribed: true, emailUnsubscribedAt: null }, now);
    expect(data).toMatchObject({ email: 'deleted-12345678@anonymized.invalid', firstName: 'Deleted', lastName: 'User', emailUnsubscribedAt: now, anonymizedAt: now, buyerSessionsValidAfter: now });
    expect(suppressionHash(' Ada@Example.com ', 's')).toBe(suppressionHash('ada@example.com', 's'));
    expect(suppressionHash('ada@example.com', 's')).not.toBe(suppressionHash('ada@example.com', 't'));
    expect(suppressionHash('ada@example.com', 's')).not.toContain('ada');
  });
});
