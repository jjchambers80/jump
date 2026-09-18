// Contract tests for Applications — spec 011 phase 3 (scale and polish)
// CSV export with absolute photo URLs, price-changed notice on the admin
// detail, bulk waitlist/reject on PAID forms, applicant profile edit + photo
// upload from the account, organizer daily digest (service + settings),
// event duplication copying forms. Resend mocked; Postgres and local image
// storage are real.

import { jest } from '@jest/globals';
import request from 'supertest';
import sharp from 'sharp';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';

const sentEmails = [];
jest.unstable_mockModule('../../src/config/resend.js', () => ({
  default: { emails: { send: jest.fn(async (msg) => { sentEmails.push(msg); return { id: 'mock' }; }) } },
}));

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');
const { default: buyerAuthService } = await import('../../src/services/BuyerAuthService.js');
const { default: applicationDigestService } = await import('../../src/services/ApplicationDigestService.js');

const TAG = 'apps-p3';

async function png() {
  return sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 20, g: 200, b: 20 } } }).png().toBuffer();
}

describe('Applications contract (spec 011 phase 3)', () => {
  let adminToken;
  let organizerToken;
  let adminBToken;
  let org;
  let orgB;
  let eventId;
  let freeForm;
  let paidForm;
  let tier;
  const emails = [`admin@${TAG}.test`, `organizer@${TAG}.test`, `admin-b@${TAG}.test`];
  const auth = (token) => ['Authorization', `Bearer ${token}`];
  let seq = 0;

  /** A SUBMITTED application on the PAID form with the amount snapshot the form quotes today. */
  async function paidApplication(overrides = {}) {
    seq += 1;
    const contact = await prisma.contact.create({ data: { organizationId: org.id, email: `vendor${seq}@${TAG}.test`, firstName: 'V', lastName: `${seq}` } });
    const profile = await prisma.applicantProfile.create({ data: { organizationId: org.id, contactId: contact.id, businessName: `Booth ${seq}` } });
    const t = paidForm.tiers[0];
    return prisma.application.create({
      data: {
        formId: paidForm.id,
        eventId,
        organizationId: org.id,
        contactId: contact.id,
        profileId: profile.id,
        tierId: t.id,
        status: 'SUBMITTED',
        paymentStatus: 'NOT_REQUIRED',
        submittedAt: new Date(),
        statusTokenHash: `hash-${TAG}-${seq}`,
        subtotal: t.amounts.subtotal,
        platformFee: t.amounts.platformFee,
        processingFee: t.amounts.processingFee,
        tax: t.amounts.tax,
        applicantPays: t.amounts.applicantPays,
        orgReceives: t.amounts.orgReceives,
        feeMode: t.amounts.feeMode,
        ...overrides,
      },
    });
  }

  beforeAll(async () => {
    await prisma.organization.deleteMany({ where: { name: { startsWith: `${TAG} ` } } }).catch(() => {});
    adminToken = await staffToken({ email: emails[0], role: 'ADMIN' });
    organizerToken = await staffToken({ email: emails[1], role: 'ORGANIZER' });
    adminBToken = await staffToken({ email: emails[2], role: 'ADMIN' });
    org = await prisma.organization.create({ data: { name: `${TAG} Gaming Geek`, email: `owner@${TAG}.test` } });
    orgB = await prisma.organization.create({ data: { name: `${TAG} Other Org` } });
    await joinOrgByToken(adminToken, org.id, 'ADMIN');
    await joinOrgByToken(organizerToken, org.id, 'ORGANIZER');
    await joinOrgByToken(adminBToken, orgB.id, 'ADMIN');
    const venue = await prisma.venue.create({ data: { organizationId: org.id, name: `${TAG} RCC`, address: '500 S Salisbury St', city: 'Raleigh', state: 'NC' } });
    const event = await prisma.event.create({
      data: {
        venueId: venue.id,
        name: `${TAG} Expo 2027`,
        date: new Date('2027-09-18T15:00:00Z'),
        status: 'PUBLISHED',
        capacity: 1000,
        taxRate: 0.0725,
        priceTiers: { create: [{ name: 'GA', price: 25, quantityTotal: 500, displayOrder: 0, saleEndDate: new Date('2027-09-18T00:00:00Z') }] },
      },
    });
    eventId = event.id;

    const free = await request(app)
      .post(`/admin/events/${eventId}/application-forms`)
      .set(...auth(adminToken))
      .send({
        kind: 'FREE',
        name: 'Press & Media',
        questions: [
          { label: 'Outlet name', type: 'SHORT_TEXT', required: true },
          { label: 'Press badge photo', type: 'PHOTO' },
        ],
      });
    expect(free.status).toBe(201);
    const opened = await request(app).patch(`/admin/events/${eventId}/application-forms/${free.body.id}`).set(...auth(adminToken)).send({ status: 'OPEN' });
    expect(opened.status).toBe(200);
    freeForm = opened.body;
    const paid = await request(app)
      .post(`/admin/events/${eventId}/application-forms`)
      .set(...auth(adminToken))
      .send({ kind: 'PAID', name: 'Vendor Space', feeMode: 'PASS', chargeTiming: 'APPROVAL', tiers: [{ name: '10x10', price: 275, quantityTotal: 5 }] });
    expect(paid.status).toBe(201);
    paidForm = paid.body;
    tier = paidForm.tiers[0];
  });

  afterAll(async () => {
    const events = await prisma.event.findMany({ where: { venue: { organizationId: org.id } }, select: { id: true } });
    const ids = events.map((e) => e.id);
    await prisma.application.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.applicantProfile.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.applicationForm.deleteMany({ where: { eventId: { in: ids } } }).catch(() => {});
    await prisma.contact.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.event.deleteMany({ where: { id: { in: ids } } }).catch(() => {});
    await prisma.venue.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.organization.deleteMany({ where: { id: { in: [org.id, orgB.id] } } }).catch(() => {});
    await cleanupStaff(emails);
  });

  beforeEach(() => {
    sentEmails.length = 0;
  });

  // ─── CSV photos ───────────────────────────────────────────────────────────

  describe('CSV export', () => {
    it('lists profile photos and photo answers as absolute URLs', async () => {
      process.env.BACKEND_URL = 'https://api.example.test/';
      const q = Object.fromEntries(freeForm.questions.map((x) => [x.label, x.id]));
      const image = await png();
      const sub = await request(app)
        .post(`/events/${eventId}/applications`)
        .field('payload', JSON.stringify({ formSlug: freeForm.slug, contact: { email: `press@${TAG}.test`, firstName: 'Pat', lastName: 'Press' }, profile: { businessName: 'Retro Weekly' }, answers: { [q['Outlet name']]: 'Retro Weekly' } }))
        .attach('profilePhotos', image, 'booth.png')
        .attach(`answer:${q['Press badge photo']}`, image, 'badge.png');
      expect(sub.status).toBe(201);

      const res = await request(app).get(`/admin/events/${eventId}/applications/export.csv?form=${freeForm.id}`).set(...auth(organizerToken));
      expect(res.status).toBe(200);
      const [header, ...lines] = res.text.split('\r\n');
      const cols = header.split(',');
      const photoIdx = cols.indexOf('profilePhotos');
      const badgeIdx = cols.indexOf('Press badge photo');
      expect(photoIdx).toBeGreaterThan(-1);
      const row = lines.find((l) => l.includes('Retro Weekly')).split(',');
      expect(row[photoIdx]).toMatch(/^https:\/\/api\.example\.test\/images\/[^/]+\/[a-f0-9]+\/original$/);
      expect(row[badgeIdx]).toMatch(/^https:\/\/api\.example\.test\/images\//);
      delete process.env.BACKEND_URL;
    });
  });

  // ─── Price changed ────────────────────────────────────────────────────────

  describe('price-changed notice', () => {
    it('admin detail carries pricing.changed once the tier price differs from the snapshot', async () => {
      const application = await paidApplication();
      let res = await request(app).get(`/admin/events/${eventId}/applications/${application.id}`).set(...auth(organizerToken));
      expect(res.status).toBe(200);
      expect(res.body.pricing).toMatchObject({ changed: false, currentApplicantPays: res.body.amounts.applicantPays });

      const edit = await request(app).patch(`/admin/events/${eventId}/application-forms/${paidForm.id}/tiers/${tier.id}`).set(...auth(adminToken)).send({ price: 300 });
      expect(edit.status).toBe(200);

      res = await request(app).get(`/admin/events/${eventId}/applications/${application.id}`).set(...auth(organizerToken));
      expect(res.body.pricing.changed).toBe(true);
      expect(res.body.pricing.currentApplicantPays).toBeGreaterThan(res.body.amounts.applicantPays);
      // The snapshot is untouched: it is the only amount ever charged.
      expect(res.body.amounts.subtotal).toBe(275);

      await request(app).patch(`/admin/events/${eventId}/application-forms/${paidForm.id}/tiers/${tier.id}`).set(...auth(adminToken)).send({ price: 275 });
    });

    it('is null for FREE applications', async () => {
      const row = await prisma.application.findFirst({ where: { formId: freeForm.id } });
      const res = await request(app).get(`/admin/events/${eventId}/applications/${row.id}`).set(...auth(organizerToken));
      expect(res.body.pricing).toBeNull();
    });
  });

  // ─── Bulk on PAID ─────────────────────────────────────────────────────────

  describe('bulk decisions on PAID forms', () => {
    it('waitlists and rejects in bulk; approve still refused per application', async () => {
      const a = await paidApplication();
      const b = await paidApplication();
      const c = await paidApplication();
      let res = await request(app).post(`/admin/events/${eventId}/applications/bulk`).set(...auth(organizerToken)).send({ ids: [a.id, b.id], decision: 'WAITLIST' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ succeeded: 2, failed: 0 });
      expect(sentEmails.length).toBe(2);

      res = await request(app).post(`/admin/events/${eventId}/applications/bulk`).set(...auth(organizerToken)).send({ ids: [a.id, c.id], decision: 'REJECT' });
      expect(res.body).toMatchObject({ succeeded: 2, failed: 0 });
      const rows = await prisma.application.findMany({ where: { id: { in: [a.id, b.id, c.id] } }, select: { id: true, status: true } });
      expect(Object.fromEntries(rows.map((r) => [r.id, r.status]))).toEqual({ [a.id]: 'REJECTED', [b.id]: 'WAITLISTED', [c.id]: 'REJECTED' });

      res = await request(app).post(`/admin/events/${eventId}/applications/bulk`).set(...auth(organizerToken)).send({ ids: [b.id], decision: 'APPROVE' });
      expect(res.body).toMatchObject({ succeeded: 0, failed: 1 });
      expect(res.body.results[0].error).toMatch(/one at a time/);
    });
  });

  // ─── Applicant profile from the account ───────────────────────────────────

  describe('applicant profile self-service', () => {
    let token;
    beforeAll(async () => {
      const contact = await prisma.contact.findUnique({ where: { organizationId_email: { organizationId: org.id, email: `press@${TAG}.test` } } });
      token = buyerAuthService.signSession({ contactId: contact.id, organizationId: org.id, email: contact.email });
    });

    it('PATCH updates text fields and rejects a bad website', async () => {
      let res = await request(app).patch('/buyer/me/applicant-profile').set(...auth(token)).send({ description: 'Weekly retro gaming coverage', website: 'retroweekly.example', socials: { instagram: '@retroweekly' } });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ businessName: 'Retro Weekly', description: 'Weekly retro gaming coverage', website: 'https://retroweekly.example', socials: { instagram: '@retroweekly' } });
      res = await request(app).patch('/buyer/me/applicant-profile').set(...auth(token)).send({ website: 'not a url' });
      expect(res.status).toBe(400);
    });

    it('uploads photos up to the cap and removes one', async () => {
      const image = await png();
      let res = await request(app).post('/buyer/me/applicant-profile/photos').set(...auth(token)).attach('photos', image, 'a.png');
      expect(res.status).toBe(200);
      // The submission already attached one (same bytes → same image row), so the upsert leaves one photo.
      expect(res.body.photos.length).toBeGreaterThanOrEqual(1);
      expect(res.body.photos[0].urls.thumb).toMatch(/^\/images\//);

      res = await request(app).post('/buyer/me/applicant-profile/photos').set(...auth(token)).attach('photos', Buffer.from('nope'), 'a.txt');
      expect(res.status).toBe(400);

      const imageId = res.body.photos?.[0]?.imageId ?? (await request(app).get('/buyer/me/applicant-profile').set(...auth(token))).body.photos[0].imageId;
      res = await request(app).delete(`/buyer/me/applicant-profile/photos/${imageId}`).set(...auth(token));
      expect(res.status).toBe(200);
      expect(res.body.photos.find((p) => p.imageId === imageId)).toBeUndefined();
    });

    it('requires a buyer session', async () => {
      const res = await request(app).post('/buyer/me/applicant-profile/photos').attach('photos', await png(), 'a.png');
      expect(res.status).toBe(401);
    });
  });

  // ─── Daily digest ─────────────────────────────────────────────────────────

  describe('organizer daily digest', () => {
    it('emails every member once per window, grouped by event and form, then stays quiet', async () => {
      await prisma.organization.update({ where: { id: org.id }, data: { applicationDigestAt: null, applicationDigestEnabled: true } });
      await paidApplication();
      await paidApplication();
      const now = new Date();
      const first = await applicationDigestService.sendDue(now);
      expect(first.sent).toBeGreaterThanOrEqual(1);
      const ours = sentEmails.filter((m) => m.subject.includes(`${TAG} Gaming Geek`));
      expect(ours.map((m) => m.to[0]).sort()).toEqual([emails[0], emails[1]].sort());
      expect(ours[0].text).toContain(`${TAG} Expo 2027`);
      expect(ours[0].text).toContain('Vendor Space:');
      // Spec 019: the digest opens the Participants list — per event inline, org-wide as the button.
      expect(ours[0].text).toContain(`/admin/participants?event=${eventId}&status=SUBMITTED`);
      expect(ours[0].text).toContain('/admin/participants?status=SUBMITTED');
      expect(ours[0].html).toMatch(/href="[^"]*\/admin\/participants\?status=SUBMITTED"[^>]*>Open</);
      expect(ours[0].html).not.toContain('<script');

      // Same hour again: window claimed, nothing sent.
      sentEmails.length = 0;
      await applicationDigestService.sendDue(new Date(now.getTime() + 60 * 1000));
      expect(sentEmails.filter((m) => m.subject.includes(`${TAG} Gaming Geek`))).toHaveLength(0);

      // A day later with no new submissions: window advances, nothing sent.
      const later = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      await applicationDigestService.sendDue(later);
      expect(sentEmails.filter((m) => m.subject.includes(`${TAG} Gaming Geek`))).toHaveLength(0);
      const orgRow = await prisma.organization.findUnique({ where: { id: org.id } });
      expect(orgRow.applicationDigestAt.getTime()).toBe(later.getTime());
    });

    it('settings: GET reflects state, PATCH is ADMIN only and validated; disabled orgs are skipped', async () => {
      let res = await request(app).get('/admin/settings/application-digest').set(...auth(organizerToken));
      expect(res.status).toBe(200);
      expect(res.body.enabled).toBe(true);

      res = await request(app).patch('/admin/settings/application-digest').set(...auth(organizerToken)).send({ enabled: false });
      expect(res.status).toBe(403);
      res = await request(app).patch('/admin/settings/application-digest').set(...auth(adminToken)).send({ enabled: 'no' });
      expect(res.status).toBe(400);
      res = await request(app).patch('/admin/settings/application-digest').set(...auth(adminToken)).send({ enabled: false });
      expect(res.status).toBe(200);
      expect(res.body.enabled).toBe(false);

      await prisma.organization.update({ where: { id: org.id }, data: { applicationDigestAt: null } });
      await paidApplication();
      await applicationDigestService.sendDue(new Date());
      expect(sentEmails.filter((m) => m.subject.includes(`${TAG} Gaming Geek`))).toHaveLength(0);
      await request(app).patch('/admin/settings/application-digest').set(...auth(adminToken)).send({ enabled: true });
    });
  });

  // ─── Event duplicate ──────────────────────────────────────────────────────

  describe('event duplicate', () => {
    it('copies tiers and application forms into a DRAFT on the new date', async () => {
      const res = await request(app).post(`/organizations/${org.id}/events/${eventId}/duplicate`).set(...auth(organizerToken)).send({ date: '2028-09-16T15:00:00Z' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ name: `Copy of ${TAG} Expo 2027`, status: 'DRAFT', capacity: 1000, copiedForms: 2 });
      expect(res.body.priceTiers).toHaveLength(1);
      expect(res.body.priceTiers[0]).toMatchObject({ name: 'GA', quantitySold: 0, saleEndDate: null });

      const forms = await request(app).get(`/admin/events/${res.body.id}/application-forms`).set(...auth(organizerToken));
      expect(forms.status).toBe(200);
      const byName = Object.fromEntries(forms.body.data.map((f) => [f.name, f]));
      expect(byName['Vendor Space']).toMatchObject({ kind: 'PAID', status: 'DRAFT', slug: paidForm.slug, opensAt: null, closesAt: null });
      expect(byName['Vendor Space'].tiers[0]).toMatchObject({ name: '10x10', price: 275, remaining: 5 });
      expect(byName['Press & Media'].questions.map((q) => q.label)).toEqual(['Outlet name', 'Press badge photo']);
      const apps = await prisma.application.count({ where: { eventId: res.body.id } });
      expect(apps).toBe(0);
    });

    it('validates the date, honours a custom name, and is scoped to the caller organization', async () => {
      let res = await request(app).post(`/organizations/${org.id}/events/${eventId}/duplicate`).set(...auth(organizerToken)).send({ date: '2020-01-01T00:00:00Z' });
      expect(res.status).toBe(400);
      res = await request(app).post(`/organizations/${org.id}/events/${eventId}/duplicate`).set(...auth(organizerToken)).send({});
      expect(res.status).toBe(400);
      res = await request(app).post(`/organizations/${org.id}/events/${eventId}/duplicate`).set(...auth(adminBToken)).send({ date: '2028-09-16T15:00:00Z' });
      expect(res.status).toBe(403);
      res = await request(app).post(`/organizations/${orgB.id}/events/${eventId}/duplicate`).set(...auth(adminBToken)).send({ date: '2028-09-16T15:00:00Z' });
      expect(res.status).toBe(404);
      res = await request(app).post(`/organizations/${org.id}/events/${eventId}/duplicate`).set(...auth(adminToken)).send({ date: '2028-10-16T15:00:00Z', name: 'Expo 2028' });
      expect(res.status).toBe(201);
      expect(res.body.name).toBe('Expo 2028');
    });
  });
});
