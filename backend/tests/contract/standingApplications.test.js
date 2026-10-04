// Contract tests for organization-level standing application forms (spec 044A).

import { jest } from '@jest/globals';
import request from 'supertest';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';
import { allAcceptances } from '../helpers/legal.js';

const sentEmails = [];
jest.unstable_mockModule('../../src/config/resend.js', () => ({
  default: { emails: { send: jest.fn(async (message) => { sentEmails.push(message); return { id: 'mock' }; }) } },
}));

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');

const TAG = 'standing-apps-ct';

describe('Standing applications contract (spec 044A)', () => {
  let adminToken;
  let org;
  let event;
  let eventForm;
  let businessForm;
  let generalForm;
  const emails = [`admin@${TAG}.test`];
  const auth = (token) => ['Authorization', `Bearer ${token}`];

  async function createStanding(body) {
    return request(app)
      .post('/admin/standing-application-forms')
      .set(...auth(adminToken))
      .send(body);
  }

  async function setStatus(formId, status) {
    return request(app)
      .patch(`/admin/standing-application-forms/${formId}`)
      .set(...auth(adminToken))
      .send({ status });
  }

  async function submit(form, suffix, overrides = {}) {
    const question = form.questions?.[0];
    return request(app)
      .post(`/organizations/${org.id}/public/apply/${form.slug}`)
      .send({
        contact: {
          email: `person-${suffix}@${TAG}.test`,
          firstName: 'Pat',
          lastName: suffix,
        },
        profile: { businessName: `Studio ${suffix}`, website: 'studio.example' },
        answers: question ? { [question.id]: `Answer ${suffix}` } : {},
        acceptances: allAcceptances(),
        ...overrides,
      });
  }

  beforeAll(async () => {
    await prisma.organization.deleteMany({ where: { name: { startsWith: `${TAG} ` } } }).catch(() => {});
    adminToken = await staffToken({ email: emails[0], role: 'ADMIN' });
    org = await prisma.organization.create({ data: { name: `${TAG} Organization`, email: `owner@${TAG}.test` } });
    await joinOrgByToken(adminToken, org.id, 'ADMIN');
    const venue = await prisma.venue.create({
      data: { organizationId: org.id, name: `${TAG} Hall`, address: '500 S Salisbury St', city: 'Raleigh', state: 'NC' },
    });
    event = await prisma.event.create({
      data: { venueId: venue.id, name: `${TAG} Event`, date: new Date('2027-09-18T15:00:00Z'), status: 'PUBLISHED', capacity: 100 },
    });
    const created = await request(app)
      .post(`/admin/events/${event.id}/application-forms`)
      .set(...auth(adminToken))
      .send({ kind: 'FREE', name: 'Event Volunteers' });
    expect(created.status).toBe(201);
    eventForm = created.body;
  });

  afterAll(async () => {
    if (org) {
      await prisma.application.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
      await prisma.applicantProfile.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
      await prisma.contact.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
      await prisma.applicationForm.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
      await prisma.event.deleteMany({ where: { venue: { organizationId: org.id } } }).catch(() => {});
      await prisma.venue.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
      await prisma.organization.deleteMany({ where: { id: org.id } }).catch(() => {});
    }
    await cleanupStaff(emails);
  });

  beforeEach(() => {
    sentEmails.length = 0;
  });

  it('allows only FREE forms and allocates standing slugs within an organization', async () => {
    const paid = await createStanding({ kind: 'PAID', name: 'Paid Membership' });
    expect(paid.status).toBe(400);
    expect(paid.body.message).toMatch(/Standing forms must be FREE/);

    await expect(prisma.applicationForm.create({
      data: {
        organizationId: org.id,
        eventId: null,
        kind: 'PAID',
        name: 'Database bypass',
        slug: 'database-bypass',
      },
    })).rejects.toThrow(/violates check constraint/);

    const first = await createStanding({
      name: 'Community Program',
      collectBusiness: true,
      questions: [{ label: 'Why are you applying?', type: 'LONG_TEXT', required: true }],
    });
    const second = await createStanding({ name: 'Community Program', collectBusiness: false });

    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({
      organizationId: org.id,
      eventId: null,
      kind: 'FREE',
      slug: 'community-program',
      status: 'DRAFT',
      collectBusiness: true,
    });
    expect(second.status).toBe(201);
    expect(second.body.slug).toBe('community-program-2');
    businessForm = first.body;
    generalForm = second.body;
  });

  it('refuses DRAFT forms, creates the tenant Contact and profile when OPEN, and stays out of event lists', async () => {
    const draft = await submit(businessForm, 'draft');
    expect([404, 409]).toContain(draft.status);

    expect((await setStatus(businessForm.id, 'OPEN')).status).toBe(200);
    const submitted = await submit(businessForm, 'business');
    expect(submitted.status).toBe(201);
    expect(submitted.body).toMatchObject({ applicationId: expect.any(String), orderRef: null, next: 'done' });

    const contact = await prisma.contact.findUnique({
      where: { organizationId_email: { organizationId: org.id, email: `person-business@${TAG}.test` } },
    });
    expect(contact).toMatchObject({ firstName: 'Pat', lastName: 'business' });
    const row = await prisma.application.findUnique({ where: { id: submitted.body.applicationId }, include: { profile: true } });
    expect(row).toMatchObject({
      formId: businessForm.id,
      eventId: null,
      organizationId: org.id,
      contactId: contact.id,
      status: 'SUBMITTED',
      paymentStatus: 'NOT_REQUIRED',
      submittedAt: expect.any(Date),
    });
    expect(row.profile).toMatchObject({ organizationId: org.id, contactId: contact.id, businessName: 'Studio business', website: 'https://studio.example' });

    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].subject).toBe(`We received your ${businessForm.name} application`);
    expect(sentEmails[0].text).toContain(submitted.body.statusUrl);

    const token = new URL(submitted.body.statusUrl).searchParams.get('token');
    const status = await request(app).get(`/organizations/${org.id}/public/apply/status/${submitted.body.applicationId}`).query({ token });
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ id: submitted.body.applicationId, event: null, status: 'SUBMITTED' });

    const eventForms = await request(app).get(`/admin/events/${event.id}/application-forms`).set(...auth(adminToken));
    expect(eventForms.body.data.map((form) => form.id)).toEqual([eventForm.id]);
    const participantForms = await request(app).get('/admin/application-forms').set(...auth(adminToken));
    expect(participantForms.body.data.map((form) => form.id)).toEqual([eventForm.id]);
    const eventApplications = await request(app).get(`/admin/events/${event.id}/applications`).set(...auth(adminToken));
    expect(eventApplications.body.data.map((application) => application.id)).not.toContain(submitted.body.applicationId);
    const participants = await request(app).get('/admin/applications').set(...auth(adminToken));
    expect(participants.body.data.map((application) => application.id)).not.toContain(submitted.body.applicationId);
  });

  it('creates a Contact without an ApplicantProfile when business collection is off', async () => {
    expect((await setStatus(generalForm.id, 'OPEN')).status).toBe(200);
    const submitted = await submit(generalForm, 'general', { profile: undefined });
    expect(submitted.status).toBe(201);
    const row = await prisma.application.findUnique({
      where: { id: submitted.body.applicationId },
      include: { contact: true, profile: true },
    });
    expect(row.eventId).toBeNull();
    expect(row.profileId).toBeNull();
    expect(row.profile).toBeNull();
    expect(row.contact.email).toBe(`person-general@${TAG}.test`);
  });

  it('exposes the four standing email templates', async () => {
    const response = await request(app)
      .get('/admin/settings/application-templates?scope=STANDING')
      .set(...auth(adminToken));
    expect(response.status).toBe(200);
    expect(response.body.data.map(({ action, scope }) => [action, scope])).toEqual([
      ['RECEIVED', 'STANDING'],
      ['APPROVED', 'STANDING'],
      ['WAITLISTED', 'STANDING'],
      ['REJECTED', 'STANDING'],
    ]);
  });

  it.each([
    ['APPROVE', 'APPROVED', /was approved/],
    ['WAITLIST', 'WAITLISTED', /on the waitlist/],
    ['REJECT', 'REJECTED', /not able to approve/],
  ])('sends the STANDING template for %s', async (decision, expectedStatus, expectedText) => {
    const submitted = await submit(generalForm, decision.toLowerCase(), { profile: undefined });
    expect(submitted.status).toBe(201);
    expect(sentEmails).toHaveLength(1);
    const decided = await request(app)
      .post(`/admin/standing-application-forms/${generalForm.id}/submissions/${submitted.body.applicationId}/decision`)
      .set(...auth(adminToken))
      .send({ decision });
    expect(decided.status).toBe(200);
    expect(decided.body.status).toBe(expectedStatus);
    expect(sentEmails).toHaveLength(2);
    expect(sentEmails.at(-1).text).toMatch(expectedText);
    expect(sentEmails.at(-1).text).not.toContain('{{');
  });

  it('refuses organizer withdrawal because standing forms have no withdrawal template', async () => {
    const submitted = await submit(generalForm, 'withdraw', { profile: undefined });
    expect(submitted.status).toBe(201);
    const response = await request(app)
      .post(`/admin/standing-application-forms/${generalForm.id}/submissions/${submitted.body.applicationId}/decision`)
      .set(...auth(adminToken))
      .send({ decision: 'WITHDRAW' });
    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/approved, rejected, or waitlisted/);
  });

  it('refuses submissions after a standing form is CLOSED, including honeypots', async () => {
    expect((await setStatus(generalForm.id, 'CLOSED')).status).toBe(200);
    const before = await prisma.application.count({ where: { formId: generalForm.id } });
    const submitted = await submit(generalForm, 'closed', { profile: undefined });
    expect(submitted.status).toBe(409);
    expect(submitted.body.message).toMatch(/closed/);
    const honeypot = await request(app)
      .post(`/organizations/${org.id}/public/apply/${generalForm.slug}`)
      .send({ honeypot: 'filled' });
    expect(honeypot.status).toBe(400);
    expect(await prisma.application.count({ where: { formId: generalForm.id } })).toBe(before);
  });
});
