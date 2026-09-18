// Contract tests for Applications (spec 011 phase 1)
// Forms CRUD + RBAC, public read and submit (JSON and multipart with a
// photo), guest status page, organizer decisions and the state machine,
// tier capacity under concurrent approvals, bulk, CSV export, templates,
// buyer views, tenant isolation. Resend mocked; Postgres and local image
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

const TAG = 'apps-ct';

async function png() {
  return sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 200, g: 20, b: 20 } } }).png().toBuffer();
}

describe('Applications contract (spec 011 phase 1)', () => {
  let adminToken;
  let organizerToken;
  let adminBToken;
  let adminUserId;
  let org;
  let orgB;
  let eventId;
  let draftEventId;
  let freeForm;
  let paidForm;
  const emails = [`admin@${TAG}.test`, `organizer@${TAG}.test`, `admin-b@${TAG}.test`];
  const auth = (token) => ['Authorization', `Bearer ${token}`];

  beforeAll(async () => {
    await prisma.organization.deleteMany({ where: { name: { startsWith: `${TAG} ` } } }).catch(() => {});
    adminToken = await staffToken({ email: emails[0], role: 'ADMIN' });
    organizerToken = await staffToken({ email: emails[1], role: 'ORGANIZER' });
    adminBToken = await staffToken({ email: emails[2], role: 'ADMIN' });
    adminUserId = (await prisma.user.findUnique({ where: { email: emails[0] } })).id;
    org = await prisma.organization.create({ data: { name: `${TAG} Gaming Geek`, email: `owner@${TAG}.test` } });
    orgB = await prisma.organization.create({ data: { name: `${TAG} Other Org` } });
    await joinOrgByToken(adminToken, org.id, 'ADMIN');
    await joinOrgByToken(organizerToken, org.id, 'ORGANIZER');
    await joinOrgByToken(adminBToken, orgB.id, 'ADMIN');
    const venue = await prisma.venue.create({ data: { organizationId: org.id, name: `${TAG} RCC`, address: '500 S Salisbury St', city: 'Raleigh', state: 'NC' } });
    const event = await prisma.event.create({
      data: { venueId: venue.id, name: `${TAG} Expo 2027`, date: new Date('2027-09-18T15:00:00Z'), status: 'PUBLISHED', capacity: 1000, taxRate: 0.0725 },
    });
    eventId = event.id;
    const draft = await prisma.event.create({
      data: { venueId: venue.id, name: `${TAG} Draft Event`, date: new Date('2027-10-18T15:00:00Z'), status: 'DRAFT', capacity: 10 },
    });
    draftEventId = draft.id;
  });

  afterAll(async () => {
    delete process.env.APPLICATIONS_PAYMENTS_ENABLED;
    await prisma.application.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.applicantProfile.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.applicationForm.deleteMany({ where: { eventId: { in: [eventId, draftEventId] } } }).catch(() => {});
    await prisma.contact.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.event.deleteMany({ where: { id: { in: [eventId, draftEventId] } } }).catch(() => {});
    await prisma.venue.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.organization.deleteMany({ where: { id: { in: [org.id, orgB.id] } } }).catch(() => {});
    await cleanupStaff(emails);
  });

  beforeEach(() => {
    sentEmails.length = 0;
  });

  // ─── Forms ────────────────────────────────────────────────────────────────

  describe('forms', () => {
    it('ADMIN creates a FREE form with questions; ORGANIZER may read but not write', async () => {
      const res = await request(app)
        .post(`/admin/events/${eventId}/application-forms`)
        .set(...auth(adminToken))
        .send({
          kind: 'FREE',
          name: 'Press & Media',
          intro: 'Tell us about your outlet.',
          questions: [
            { label: 'Outlet name', type: 'SHORT_TEXT', required: true },
            { label: 'Coverage type', type: 'SINGLE_CHOICE', options: ['Print', 'Video', 'Podcast'], required: true },
            { label: 'Portfolio URL', type: 'URL' },
            { label: 'Press badge photo', type: 'PHOTO' },
            { label: 'Agree to media policy', type: 'CHECKBOX', required: true },
          ],
        });
      expect(res.status).toBe(201);
      freeForm = res.body;
      expect(freeForm).toMatchObject({ kind: 'FREE', slug: 'press-media', status: 'DRAFT', acceptance: { open: false, reason: 'not_published' } });
      expect(freeForm.questions.map((q) => q.label)).toEqual(['Outlet name', 'Coverage type', 'Portfolio URL', 'Press badge photo', 'Agree to media policy']);
      expect(freeForm.tiers).toEqual([]);

      const forbidden = await request(app).post(`/admin/events/${eventId}/application-forms`).set(...auth(organizerToken)).send({ kind: 'FREE', name: 'Nope' });
      expect(forbidden.status).toBe(403);
      const list = await request(app).get(`/admin/events/${eventId}/application-forms`).set(...auth(organizerToken));
      expect(list.status).toBe(200);
      expect(list.body.data.map((f) => f.id)).toContain(freeForm.id);
    });

    it('validates form bodies', async () => {
      const cases = [
        [{ name: 'X' }, /kind is required/],
        [{ kind: 'PAID', name: 'Vendors', bogus: 1 }, /Unknown form field/],
        [{ kind: 'FREE', name: 'Panels', tiers: [{ name: '10x10', price: 275, quantityTotal: 10 }] }, /FREE forms cannot have tiers/],
        [{ kind: 'FREE', name: 'Panels', feeMode: 'ABSORB' }, /PAID forms only/],
        [{ kind: 'FREE', name: 'P' }, /2-80 characters/],
        [{ kind: 'FREE', name: 'Panels', opensAt: '2027-01-10', closesAt: '2027-01-01' }, /closesAt must be after/],
        [{ kind: 'FREE', name: 'Panels', questions: [{ label: 'Pick', type: 'SINGLE_CHOICE', options: ['only'] }] }, /at least two options/],
        [{ kind: 'FREE', name: 'Panels', questions: [{ label: 'Pick', type: 'ESSAY' }] }, /question type must be/],
      ];
      for (const [body, message] of cases) {
        const res = await request(app).post(`/admin/events/${eventId}/application-forms`).set(...auth(adminToken)).send(body);
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(message);
      }
    });

    it('ADMIN creates a PAID form with tiers; it cannot OPEN while application payments are off', async () => {
      delete process.env.APPLICATIONS_PAYMENTS_ENABLED;
      const res = await request(app)
        .post(`/admin/events/${eventId}/application-forms`)
        .set(...auth(adminToken))
        .send({
          kind: 'PAID',
          name: 'Vendor Space',
          feeMode: 'PASS',
          chargeTiming: 'APPROVAL',
          tiers: [
            { name: '10x10', price: 275, quantityTotal: 1 },
            { name: '10x20', price: 550, quantityTotal: 5 },
          ],
        });
      expect(res.status).toBe(201);
      paidForm = res.body;
      expect(paidForm.paymentsEnabled).toBe(false);
      const t = paidForm.tiers[0];
      expect(t).toMatchObject({ name: '10x10', price: 275, remaining: 1 });
      // PASS: applicant pays fees on top; no tax on booths by default
      expect(t.amounts).toMatchObject({ subtotal: 275, tax: 0, feeMode: 'PASS', orgReceives: 275 });
      expect(t.amounts.applicantPays).toBeGreaterThan(275);

      const open = await request(app).patch(`/admin/events/${eventId}/application-forms/${paidForm.id}`).set(...auth(adminToken)).send({ status: 'OPEN' });
      expect(open.status).toBe(409);
      expect(open.body.message).toMatch(/cannot open until application payments are enabled/);

      // ABSORB: applicant pays the listed price, organization nets less
      const absorb = await request(app).patch(`/admin/events/${eventId}/application-forms/${paidForm.id}`).set(...auth(adminToken)).send({ feeMode: 'ABSORB' });
      expect(absorb.status).toBe(200);
      expect(absorb.body.tiers[0].amounts).toMatchObject({ applicantPays: 275, feeMode: 'ABSORB' });
      expect(absorb.body.tiers[0].amounts.orgReceives).toBeLessThan(275);
    });

    it('tier and question edits: quantity floor, archive vs delete, reorder', async () => {
      const tierId = paidForm.tiers[1].id;
      const bad = await request(app).patch(`/admin/events/${eventId}/application-forms/${paidForm.id}/tiers/${tierId}`).set(...auth(adminToken)).send({ price: -1 });
      expect(bad.status).toBe(400);
      const ok = await request(app).patch(`/admin/events/${eventId}/application-forms/${paidForm.id}/tiers/${tierId}`).set(...auth(adminToken)).send({ quantityTotal: 6, isActive: false });
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ quantityTotal: 6, isActive: false });

      const q = await request(app).post(`/admin/events/${eventId}/application-forms/${freeForm.id}/questions`).set(...auth(adminToken)).send({ label: 'Temp', type: 'NUMBER' });
      expect(q.status).toBe(201);
      const removed = await request(app).delete(`/admin/events/${eventId}/application-forms/${freeForm.id}/questions/${q.body.id}`).set(...auth(adminToken));
      expect(removed.body).toEqual({ archived: false });

      const ids = freeForm.questions.map((x) => x.id).reverse();
      const reordered = await request(app).patch(`/admin/events/${eventId}/application-forms/${freeForm.id}/questions/reorder`).set(...auth(adminToken)).send({ ids });
      expect(reordered.status).toBe(200);
      expect(reordered.body.data.map((x) => x.id)).toEqual(ids);
      await request(app).patch(`/admin/events/${eventId}/application-forms/${freeForm.id}/questions/reorder`).set(...auth(adminToken)).send({ ids: ids.reverse() });
    });

    it('another organization cannot see or edit these forms', async () => {
      const list = await request(app).get(`/admin/events/${eventId}/application-forms`).set(...auth(adminBToken));
      expect(list.status).toBe(404);
      const edit = await request(app).patch(`/admin/events/${eventId}/application-forms/${freeForm.id}`).set(...auth(adminBToken)).send({ name: 'Hijack' });
      expect(edit.status).toBe(404);
    });
  });

  // ─── Public read + submit ─────────────────────────────────────────────────

  describe('public', () => {
    it('DRAFT forms are hidden; OPEN forms list with questions and no internal counters', async () => {
      const hidden = await request(app).get(`/events/${eventId}/applications/forms`);
      expect(hidden.status).toBe(200);
      expect(hidden.body.data).toEqual([]);

      const open = await request(app).patch(`/admin/events/${eventId}/application-forms/${freeForm.id}`).set(...auth(adminToken)).send({ status: 'OPEN' });
      expect(open.status).toBe(200);
      expect(open.body.acceptance).toEqual({ open: true, reason: null });

      const res = await request(app).get(`/events/${eventId}/applications/forms/press-media`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ kind: 'FREE', name: 'Press & Media', acceptance: { open: true } });
      expect(res.body.questions).toHaveLength(5);
      expect(res.body.quantityApproved).toBeUndefined();

      const draftEvent = await request(app).get(`/events/${draftEventId}/applications/forms`);
      expect(draftEvent.status).toBe(404);
    });

    it('rejects an incomplete submission with the question label', async () => {
      const q = Object.fromEntries(freeForm.questions.map((x) => [x.label, x.id]));
      const res = await request(app)
        .post(`/events/${eventId}/applications`)
        .send({
          formSlug: 'press-media',
          contact: { email: `PRESS@${TAG}.test`, firstName: 'Pat', lastName: 'Press' },
          profile: { businessName: 'Retro Weekly' },
          answers: { [q['Outlet name']]: 'Retro Weekly', [q['Coverage type']]: 'Radio' },
        });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/"Coverage type": choose one of the options/);

      const missing = await request(app)
        .post(`/events/${eventId}/applications`)
        .send({ formSlug: 'press-media', contact: { email: `press@${TAG}.test`, firstName: 'Pat', lastName: 'Press' }, profile: { businessName: 'Retro Weekly' }, answers: {} });
      expect(missing.status).toBe(400);
      expect(missing.body.message).toMatch(/"Outlet name" is required/);
    });

    let statusUrl;
    let applicationId;

    it('accepts a multipart submission with a profile photo and a photo answer; sends the RECEIVED email', async () => {
      const q = Object.fromEntries(freeForm.questions.map((x) => [x.label, x.id]));
      const image = await png();
      const res = await request(app)
        .post(`/events/${eventId}/applications`)
        .field(
          'payload',
          JSON.stringify({
            formSlug: 'press-media',
            contact: { email: `PRESS@${TAG}.test`, firstName: 'Pat', lastName: 'Press' },
            profile: { businessName: 'Retro Weekly', website: 'retroweekly.example', socials: { instagram: '@retroweekly' } },
            answers: { [q['Outlet name']]: 'Retro Weekly', [q['Coverage type']]: 'Video', [q['Portfolio URL']]: 'retroweekly.example/work', [q['Agree to media policy']]: true },
            optInMarketing: true,
          })
        )
        .attach('profilePhotos', image, 'booth.png')
        .attach(`answer:${q['Press badge photo']}`, image, 'badge.png');
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ next: 'done' });
      expect(res.body.statusUrl).toMatch(new RegExp(`/events/${eventId}/apply/status/${res.body.applicationId}\\?token=[a-f0-9]{64}$`));
      statusUrl = res.body.statusUrl;
      applicationId = res.body.applicationId;

      const contact = await prisma.contact.findUnique({ where: { organizationId_email: { organizationId: org.id, email: `press@${TAG}.test` } } });
      expect(contact.emailSubscribed).toBe(true);
      const profile = await prisma.applicantProfile.findUnique({ where: { organizationId_contactId: { organizationId: org.id, contactId: contact.id } }, include: { images: true } });
      expect(profile.website).toBe('https://retroweekly.example');
      expect(profile.images).toHaveLength(1);

      expect(sentEmails).toHaveLength(1);
      expect(sentEmails[0].to).toEqual([`press@${TAG}.test`]);
      expect(sentEmails[0].subject).toBe(`We received your application for ${TAG} Expo 2027`);
      expect(sentEmails[0].text).toContain('Thanks for applying to');
      expect(sentEmails[0].text).toContain(statusUrl);
    });

    it('blocks a second active application on the same form', async () => {
      const q = Object.fromEntries(freeForm.questions.map((x) => [x.label, x.id]));
      const res = await request(app)
        .post(`/events/${eventId}/applications`)
        .send({
          formSlug: 'press-media',
          contact: { email: `press@${TAG}.test`, firstName: 'Pat', lastName: 'Press' },
          profile: { businessName: 'Retro Weekly' },
          answers: { [q['Outlet name']]: 'Retro Weekly', [q['Coverage type']]: 'Video', [q['Agree to media policy']]: true },
        });
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/already have an application/);
    });

    it('guest status page needs the token; shows applicant view without internal fields', async () => {
      const token = new URL(statusUrl).searchParams.get('token');
      const ok = await request(app).get(`/applications/${applicationId}/status?token=${token}`);
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ status: 'SUBMITTED', paymentStatus: 'NOT_REQUIRED', canWithdraw: true, profile: { businessName: 'Retro Weekly' } });
      expect(ok.body.internalNote).toBeUndefined();
      expect(ok.body.answers.find((a) => a.label === 'Press badge photo').image.urls.thumb).toMatch(/\/images\//);

      expect((await request(app).get(`/applications/${applicationId}/status?token=nope`)).status).toBe(404);
      expect((await request(app).get(`/applications/${applicationId}/status`)).status).toBe(403);
    });

    it('a PAID form submission is refused while application payments are off', async () => {
      // Force the form open in the DB (the API refuses) to exercise the submit guard
      await prisma.applicationForm.update({ where: { id: paidForm.id }, data: { status: 'OPEN' } });
      const res = await request(app)
        .post(`/events/${eventId}/applications`)
        .send({ formSlug: 'vendor-space', tierId: paidForm.tiers[0].id, contact: { email: `vendor@${TAG}.test`, firstName: 'Vee', lastName: 'Vendor' }, profile: { businessName: 'Hidden Block Games' }, answers: {} });
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/not available yet/);
    });
  });

  // ─── Organizer decisions ──────────────────────────────────────────────────

  describe('decisions', () => {
    let pressApp;

    beforeAll(async () => {
      pressApp = await prisma.application.findFirst({ where: { formId: freeForm.id }, orderBy: { createdAt: 'asc' } });
    });

    it('lists with summary and filters; detail carries answers and profile', async () => {
      const list = await request(app).get(`/admin/events/${eventId}/applications?status=SUBMITTED&q=retro`).set(...auth(organizerToken));
      expect(list.status).toBe(200);
      expect(list.body.total).toBe(1);
      expect(list.body.data[0]).toMatchObject({ id: pressApp.id, businessName: 'Retro Weekly', formName: 'Press & Media', status: 'SUBMITTED' });
      expect(list.body.summary).toMatchObject({ SUBMITTED: 1 });

      const detail = await request(app).get(`/admin/events/${eventId}/applications/${pressApp.id}`).set(...auth(organizerToken));
      expect(detail.status).toBe(200);
      expect(detail.body.profile).toMatchObject({ businessName: 'Retro Weekly', website: 'https://retroweekly.example', socials: { instagram: '@retroweekly' } });
      expect(detail.body.profile.photos).toHaveLength(1);
      expect(detail.body.answers.map((a) => [a.label, a.value])).toEqual(
        expect.arrayContaining([
          ['Outlet name', 'Retro Weekly'],
          ['Coverage type', 'Video'],
          ['Portfolio URL', 'https://retroweekly.example/work'],
          ['Agree to media policy', 'true'],
        ])
      );

      const other = await request(app).get(`/admin/events/${eventId}/applications/${pressApp.id}`).set(...auth(adminBToken));
      expect(other.status).toBe(404);
    });

    it('preview renders the template with merge fields', async () => {
      const res = await request(app).post(`/admin/events/${eventId}/applications/${pressApp.id}/preview`).set(...auth(organizerToken)).send({ decision: 'WAITLIST' });
      expect(res.status).toBe(200);
      expect(res.body.subject).toBe(`You are on the waitlist for ${TAG} Expo 2027`);
      expect(res.body.body).toContain('Retro Weekly is on the waitlist');
      expect(res.body.body).not.toContain('{{');
    });

    it('SYSTEM_ADMIN (no membership, unscoped) previews and decides with the event organization’s template and the email goes out', async () => {
      const sysToken = await staffToken({ email: `sys@${TAG}.test`, role: 'SYSTEM_ADMIN' });
      const preview = await request(app).post(`/admin/events/${eventId}/applications/${pressApp.id}/preview`).set(...auth(sysToken)).send({ decision: 'WAITLIST' });
      expect(preview.status).toBe(200);
      expect(preview.body.subject).toBe(`You are on the waitlist for ${TAG} Expo 2027`);
      // An org-specific template is honoured too.
      const custom = await request(app).put('/admin/settings/application-templates/WAITLISTED').set(...auth(adminToken)).send({ subject: 'Custom waitlist {{event.name}}', body: 'Hi {{applicant.firstName}}' });
      expect(custom.status).toBe(200);
      const previewCustom = await request(app).post(`/admin/events/${eventId}/applications/${pressApp.id}/preview`).set(...auth(sysToken)).send({ decision: 'WAITLIST' });
      expect(previewCustom.body.subject).toBe(`Custom waitlist ${TAG} Expo 2027`);
      sentEmails.length = 0;
      const wl = await request(app).post(`/admin/events/${eventId}/applications/${pressApp.id}/decision`).set(...auth(sysToken)).send({ decision: 'WAITLIST' });
      expect(wl.status).toBe(200);
      expect(sentEmails).toHaveLength(1);
      expect(sentEmails[0].subject).toBe(`Custom waitlist ${TAG} Expo 2027`);
      // Put things back for the tests that follow.
      expect((await request(app).delete('/admin/settings/application-templates/WAITLISTED').set(...auth(adminToken))).status).toBe(200);
      await prisma.application.update({ where: { id: pressApp.id }, data: { status: 'SUBMITTED', decidedAt: null, decidedById: null } });
      await cleanupStaff([`sys@${TAG}.test`]);
    });

    it('ORGANIZER waitlists then approves with an edited message; transitions are enforced', async () => {
      const wl = await request(app).post(`/admin/events/${eventId}/applications/${pressApp.id}/decision`).set(...auth(organizerToken)).send({ decision: 'WAITLIST' });
      expect(wl.status).toBe(200);
      expect(wl.body.status).toBe('WAITLISTED');
      expect(sentEmails.at(-1).subject).toMatch(/waitlist/);

      const again = await request(app).post(`/admin/events/${eventId}/applications/${pressApp.id}/decision`).set(...auth(organizerToken)).send({ decision: 'WAITLIST' });
      expect(again.status).toBe(409);

      const approve = await request(app)
        .post(`/admin/events/${eventId}/applications/${pressApp.id}/decision`)
        .set(...auth(organizerToken))
        .send({ decision: 'APPROVE', note: 'Great outlet', message: { subject: 'Welcome aboard, Retro Weekly', body: 'Custom body for Pat.\n\nSee you at load-in.' } });
      expect(approve.status).toBe(200);
      expect(approve.body).toMatchObject({ status: 'APPROVED', paymentStatus: 'NOT_REQUIRED', decidedById: expect.any(String) });
      expect(approve.body.decisions.at(-1)).toMatchObject({ action: 'APPROVED', note: 'Great outlet', emailSubject: 'Welcome aboard, Retro Weekly' });
      expect(sentEmails.at(-1)).toMatchObject({ subject: 'Welcome aboard, Retro Weekly' });
      expect(sentEmails.at(-1).html).toContain('Custom body for Pat.');

      const reject = await request(app).post(`/admin/events/${eventId}/applications/${pressApp.id}/decision`).set(...auth(organizerToken)).send({ decision: 'REJECT' });
      expect(reject.status).toBe(409);
      expect(reject.body.message).toMatch(/Cannot reject an application that is approved/);
    });

    it('notes and booth label update; unknown fields rejected', async () => {
      const res = await request(app).patch(`/admin/events/${eventId}/applications/${pressApp.id}`).set(...auth(organizerToken)).send({ boothLabel: 'Media row 3', internalNote: 'VIP press' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ boothLabel: 'Media row 3', internalNote: 'VIP press' });
      expect((await request(app).patch(`/admin/events/${eventId}/applications/${pressApp.id}`).set(...auth(organizerToken)).send({ status: 'REJECTED' })).status).toBe(400);
    });

    it('withdraw from APPROVED without sending an email', async () => {
      const res = await request(app).post(`/admin/events/${eventId}/applications/${pressApp.id}/decision`).set(...auth(adminToken)).send({ decision: 'WITHDRAW', note: 'Duplicate outlet', sendEmail: false });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'WITHDRAWN', withdrawnBy: 'ORGANIZER', withdrawReason: 'Duplicate outlet' });
      expect(sentEmails).toHaveLength(0);
    });

    it('tier capacity: concurrent approvals on a 1-slot tier let exactly one through; withdraw releases it', async () => {
      const tier = await prisma.applicationTier.findFirst({ where: { formId: paidForm.id, name: '10x10' } });
      const mk = async (i) => {
        const contact = await prisma.contact.create({ data: { organizationId: org.id, email: `vendor${i}@${TAG}.test`, firstName: 'V', lastName: `${i}` } });
        const profile = await prisma.applicantProfile.create({ data: { organizationId: org.id, contactId: contact.id, businessName: `Booth ${i}` } });
        return prisma.application.create({
          data: { formId: paidForm.id, eventId, organizationId: org.id, contactId: contact.id, profileId: profile.id, tierId: tier.id, status: 'SUBMITTED', paymentStatus: 'NOT_REQUIRED', submittedAt: new Date(), statusTokenHash: `hash-${TAG}-${i}` },
        });
      };
      const [a, b, c] = await Promise.all([mk(1), mk(2), mk(3)]);
      const results = await Promise.all(
        [a, b, c].map((x) => request(app).post(`/admin/events/${eventId}/applications/${x.id}/decision`).set(...auth(adminToken)).send({ decision: 'APPROVE', sendEmail: false }))
      );
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([200, 409, 409]);
      const full = results.find((r) => r.status === 409);
      expect(full.body.message).toMatch(/tier is full/);
      expect(full.body.details).toMatchObject({ suggestion: 'WAITLIST' });
      const after = await prisma.applicationTier.findUnique({ where: { id: tier.id } });
      expect(after.quantityApproved).toBe(1);

      const winner = results.find((r) => r.status === 200).body;
      expect(winner.capacitySlot).toBe('APPROVED');
      const wd = await request(app).post(`/admin/events/${eventId}/applications/${winner.id}/decision`).set(...auth(adminToken)).send({ decision: 'WITHDRAW', sendEmail: false });
      expect(wd.status).toBe(200);
      expect((await prisma.applicationTier.findUnique({ where: { id: tier.id } })).quantityApproved).toBe(0);
    });

    it('bulk: approve refused for PAID applications, allowed for FREE; results per id', async () => {
      const paidPending = await prisma.application.findFirst({ where: { formId: paidForm.id, status: 'SUBMITTED' } });
      const q = Object.fromEntries(freeForm.questions.map((x) => [x.label, x.id]));
      const sub = await request(app)
        .post(`/events/${eventId}/applications`)
        .send({ formSlug: 'press-media', contact: { email: `panelist@${TAG}.test`, firstName: 'Pia', lastName: 'Panel' }, profile: { businessName: 'Pia Talks' }, answers: { [q['Outlet name']]: 'Pia Talks', [q['Coverage type']]: 'Podcast', [q['Agree to media policy']]: true } });
      expect(sub.status).toBe(201);

      const res = await request(app).post(`/admin/events/${eventId}/applications/bulk`).set(...auth(organizerToken)).send({ ids: [paidPending.id, sub.body.applicationId, 'missing'], decision: 'APPROVE' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ succeeded: 1, failed: 2 });
      expect(res.body.results.find((r) => r.id === paidPending.id).error).toMatch(/one at a time/);
      expect(res.body.results.find((r) => r.id === sub.body.applicationId).ok).toBe(true);
    });

    it('CSV export flattens profile and answers', async () => {
      const res = await request(app).get(`/admin/events/${eventId}/applications/export.csv?form=${freeForm.id}`).set(...auth(organizerToken));
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/csv/);
      const lines = res.text.split('\r\n');
      expect(lines[0]).toContain('businessName');
      expect(lines[0]).toContain('Coverage type');
      expect(lines.length).toBeGreaterThanOrEqual(3);
      expect(res.text).toContain('Retro Weekly');
      expect(res.text).toContain('Pia Talks');
    });
  });

  // ─── Templates ───────────────────────────────────────────────────────────

  describe('templates', () => {
    it('lists defaults with merge fields; ADMIN edits and resets; unbalanced sections rejected', async () => {
      const list = await request(app).get('/admin/settings/application-templates').set(...auth(organizerToken));
      expect(list.status).toBe(200);
      expect(list.body.data.map((t) => t.action)).toEqual(['RECEIVED', 'APPROVED', 'REJECTED', 'WAITLISTED', 'WITHDRAWN', 'PAYMENT_DUE', 'ADD_ONS_CHANGED', 'TIER_CHANGED', 'WAIVED', 'OFFLINE_PAID']);
      expect(list.body.data.every((t) => t.isDefault)).toBe(true);
      expect(list.body.mergeFields.some((m) => m.key === 'profile.businessName')).toBe(true);

      const forbidden = await request(app).put('/admin/settings/application-templates/APPROVED').set(...auth(organizerToken)).send({ subject: 'x', body: 'y' });
      expect(forbidden.status).toBe(403);

      const bad = await request(app).put('/admin/settings/application-templates/APPROVED').set(...auth(adminToken)).send({ subject: 'Hi', body: '{{#tier}}oops' });
      expect(bad.status).toBe(400);

      const saved = await request(app).put('/admin/settings/application-templates/APPROVED').set(...auth(adminToken)).send({ subject: 'Approved: {{profile.businessName}}', body: 'Hi {{applicant.firstName}}, <b>welcome</b>' });
      expect(saved.status).toBe(200);
      expect(saved.body).toMatchObject({ action: 'APPROVED', isDefault: false });

      const reset = await request(app).delete('/admin/settings/application-templates/APPROVED').set(...auth(adminToken));
      expect(reset.body.isDefault).toBe(true);
      expect((await request(app).put('/admin/settings/application-templates/NOPE').set(...auth(adminToken)).send({ subject: 'x', body: 'y' })).status).toBe(404);
    });
  });

  // ─── Buyer ───────────────────────────────────────────────────────────────

  describe('buyer', () => {
    it('applicant sees their applications and profile, withdraws while submitted, cannot see other orgs', async () => {
      const contact = await prisma.contact.findUnique({ where: { organizationId_email: { organizationId: org.id, email: `press@${TAG}.test` } } });
      const token = buyerAuthService.signSession({ contactId: contact.id, organizationId: org.id, email: contact.email });

      const list = await request(app).get('/buyer/me/applications').set(...auth(token));
      expect(list.status).toBe(200);
      expect(list.body.data).toHaveLength(1);
      expect(list.body.data[0]).toMatchObject({ status: 'WITHDRAWN', canWithdraw: false, form: { name: 'Press & Media' } });

      const profile = await request(app).get('/buyer/me/applicant-profile').set(...auth(token));
      expect(profile.body).toMatchObject({ businessName: 'Retro Weekly' });
      const edit = await request(app).patch('/buyer/me/applicant-profile').set(...auth(token)).send({ description: 'Raleigh retro gaming news', socials: { tiktok: '@rw', bogus: 'x' } });
      expect(edit.status).toBe(400);
      const ok = await request(app).patch('/buyer/me/applicant-profile').set(...auth(token)).send({ description: 'Raleigh retro gaming news' });
      expect(ok.status).toBe(200);
      expect(ok.body.description).toBe('Raleigh retro gaming news');

      // Panelist withdraws own submitted application
      const pia = await prisma.contact.findUnique({ where: { organizationId_email: { organizationId: org.id, email: `panelist@${TAG}.test` } } });
      const piaToken = buyerAuthService.signSession({ contactId: pia.id, organizationId: org.id, email: pia.email });
      const piaApp = await prisma.application.findFirst({ where: { contactId: pia.id } });
      // approved by bulk above → cannot withdraw
      const denied = await request(app).post(`/buyer/me/applications/${piaApp.id}/withdraw`).set(...auth(piaToken));
      expect(denied.status).toBe(409);
      const foreign = await request(app).get(`/buyer/me/applications/${piaApp.id}`).set(...auth(token));
      expect(foreign.status).toBe(404);
    });
  });
});
