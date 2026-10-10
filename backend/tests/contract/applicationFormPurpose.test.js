// Contract tests for ApplicationForm.purpose (spec 050 §6.2, card 050-B):
// per-purpose defaults, purpose/kind rules, FREE event forms without the
// business step, purpose fixed once submitted, templates round-trip it, and
// the admin, public and preview payloads carry it.

import request from 'supertest';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';
import { allAcceptances } from '../helpers/legal.js';

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');

const TAG = 'form-purpose-ct';

describe('Application form purpose (spec 050 §6.2)', () => {
  let adminToken;
  let org;
  let eventId;
  let draftEventId;
  let volunteer;
  const emails = [`admin@${TAG}.test`];
  const auth = () => ['Authorization', `Bearer ${adminToken}`];
  const forms = (id = eventId) => `/admin/events/${id}/application-forms`;

  beforeAll(async () => {
    await prisma.organization.deleteMany({ where: { name: { startsWith: `${TAG} ` } } }).catch(() => {});
    adminToken = await staffToken({ email: emails[0], role: 'ADMIN' });
    org = await prisma.organization.create({ data: { name: `${TAG} Org` } });
    await joinOrgByToken(adminToken, org.id, 'ADMIN');
    const venue = await prisma.venue.create({ data: { organizationId: org.id, name: `${TAG} Hall`, address: '1 Main St', city: 'Raleigh', state: 'NC' } });
    eventId = (await prisma.event.create({ data: { venueId: venue.id, name: `${TAG} Expo`, date: new Date('2027-09-18T15:00:00Z'), status: 'PUBLISHED', capacity: 100 } })).id;
    draftEventId = (await prisma.event.create({ data: { venueId: venue.id, name: `${TAG} Draft`, date: new Date('2027-10-18T15:00:00Z'), status: 'DRAFT', capacity: 100 } })).id;
  });

  afterAll(async () => {
    await prisma.application.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.applicationFormTemplate.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.applicationForm.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.contact.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.event.deleteMany({ where: { id: { in: [eventId, draftEventId] } } }).catch(() => {});
    await prisma.venue.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.organization.deleteMany({ where: { id: org.id } }).catch(() => {});
    await cleanupStaff(emails);
  });

  it('a VOLUNTEER form starts from its defaults: no business step, availability questions', async () => {
    const res = await request(app).post(forms()).set(...auth()).send({ kind: 'FREE', purpose: 'VOLUNTEER', name: 'Crew' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ purpose: 'VOLUNTEER', collectBusiness: false });
    expect(res.body.questions.map((q) => q.label)).toEqual([
      'Which days are you available?',
      'Which roles interest you?',
      'T-shirt size',
      'Emergency contact (name and phone)',
    ]);
    volunteer = res.body;
  });

  it('explicit questions win over the defaults; no purpose means OTHER', async () => {
    const own = await request(app).post(forms()).set(...auth()).send({ kind: 'FREE', purpose: 'VENDOR', name: 'Makers', questions: [] });
    expect(own.status).toBe(201);
    expect(own.body.questions).toEqual([]);
    const plain = await request(app).post(forms()).set(...auth()).send({ kind: 'FREE', name: 'Plain' });
    expect(plain.body).toMatchObject({ purpose: 'OTHER', collectBusiness: true, questions: [] });
  });

  it('SPECIAL_GUEST and VOLUNTEER refuse PAID; PAID keeps the business step; bad purpose is 400', async () => {
    for (const purpose of ['SPECIAL_GUEST', 'VOLUNTEER']) {
      const res = await request(app).post(forms()).set(...auth()).send({ kind: 'PAID', purpose, name: 'Paid guests' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('PURPOSE_KIND_MISMATCH');
    }
    const noBiz = await request(app).post(forms()).set(...auth()).send({ kind: 'PAID', purpose: 'VENDOR', name: 'Vendors', collectBusiness: false });
    expect(noBiz.status).toBe(400);
    const bad = await request(app).post(forms()).set(...auth()).send({ kind: 'FREE', purpose: 'ROADIE', name: 'Roadies' });
    expect(bad.status).toBe(400);

    const paid = await request(app).post(forms()).set(...auth()).send({ kind: 'PAID', purpose: 'SPONSOR', name: 'Sponsors' });
    expect(paid.status).toBe(201);
    const toGuest = await request(app).patch(`${forms()}/${paid.body.id}`).set(...auth()).send({ purpose: 'SPECIAL_GUEST' });
    expect(toGuest.status).toBe(400);
    expect(toGuest.body.code).toBe('PURPOSE_KIND_MISMATCH');
  });

  it('a FREE VOLUNTEER form submits without the business step', async () => {
    const open = await request(app).patch(`${forms()}/${volunteer.id}`).set(...auth()).send({ status: 'OPEN' });
    expect(open.status).toBe(200);
    const q = Object.fromEntries(volunteer.questions.map((x) => [x.label, x.id]));
    const res = await request(app)
      .post(`/events/${eventId}/applications`)
      .send({
        formSlug: volunteer.slug,
        contact: { email: `vol@${TAG}.test`, firstName: 'Val', lastName: 'Unteer' },
        acceptances: allAcceptances(),
        answers: { [q['Which days are you available?']]: ['Saturday'], [q['Emergency contact (name and phone)']]: 'Sam 555-0100' },
      });
    expect(res.status).toBe(201);
    const row = await prisma.application.findUnique({ where: { id: res.body.applicationId }, include: { profile: true } });
    expect(row).toMatchObject({ status: 'SUBMITTED', profile: null });
  });

  it('purpose is fixed once the form has submissions (409); other fields still save', async () => {
    const res = await request(app).patch(`${forms()}/${volunteer.id}`).set(...auth()).send({ purpose: 'OTHER' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PURPOSE_LOCKED');
    const same = await request(app).patch(`${forms()}/${volunteer.id}`).set(...auth()).send({ purpose: 'VOLUNTEER', intro: 'Thanks!' });
    expect(same.status).toBe(200);
  });

  it('purpose changes freely before any submission', async () => {
    const created = await request(app).post(forms()).set(...auth()).send({ kind: 'FREE', name: 'Speakers' });
    const res = await request(app).patch(`${forms()}/${created.body.id}`).set(...auth()).send({ purpose: 'PANEL' });
    expect(res.status).toBe(200);
    expect(res.body.purpose).toBe('PANEL');
  });

  it('admin list and public forms carry purpose', async () => {
    const admin = await request(app).get(forms()).set(...auth());
    expect(admin.status).toBe(200);
    expect(admin.body.data.find((f) => f.id === volunteer.id).purpose).toBe('VOLUNTEER');
    const pub = await request(app).get(`/events/${eventId}/applications/forms`);
    expect(pub.status).toBe(200);
    expect(pub.body.data).toEqual([expect.objectContaining({ id: volunteer.id, purpose: 'VOLUNTEER', collectBusiness: false })]);
  });

  it('a template round-trips its purpose', async () => {
    const saved = await request(app).post(`${forms()}/${volunteer.id}/save-as-template`).set(...auth()).send({ name: 'Crew template' });
    expect(saved.status).toBe(201);
    expect(saved.body.definition.purpose).toBe('VOLUNTEER');
    const list = await request(app).get('/admin/application-templates').set(...auth());
    const summary = (list.body.data ?? list.body).find((t) => t.id === saved.body.id);
    expect(summary.purpose).toBe('VOLUNTEER');

    const made = await request(app).post(forms(draftEventId)).set(...auth()).send({ kind: 'FREE', name: 'Crew 2', templateId: saved.body.id });
    expect(made.status).toBe(201);
    expect(made.body.purpose).toBe('VOLUNTEER');
    expect(made.body.questions).toHaveLength(4);

    const paidGuest = await request(app)
      .post('/admin/application-templates')
      .set(...auth())
      .send({ name: 'Paid guests', kind: 'PAID', definition: { purpose: 'SPECIAL_GUEST' } });
    expect(paidGuest.status).toBe(400);
    expect(paidGuest.body.code).toBe('PURPOSE_KIND_MISMATCH');
  });

  it('the preview payload includes the draft event\'s DRAFT forms with purpose', async () => {
    const res = await request(app).get(`/organizations/${org.id}/events/${draftEventId}/preview-payload`).set(...auth());
    expect(res.status).toBe(200);
    expect(res.body.forms).toEqual([expect.objectContaining({ name: 'Crew 2', purpose: 'VOLUNTEER', acceptance: { open: false, reason: 'not_published' } })]);
  });
});
