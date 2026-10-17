// Contract tests for generic application forms (spec 050 §6.2, card 050-B;
// forms lost their type): blank start, FREE event forms without the business
// step, any form may be PAID, a stale `purpose` is ignored, and the admin,
// public and preview payloads.

import request from 'supertest';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';
import { allAcceptances } from '../helpers/legal.js';

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');

const TAG = 'form-generic-ct';

describe('Generic application forms (spec 050 §6.2)', () => {
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
    await prisma.applicationForm.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.contact.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.event.deleteMany({ where: { id: { in: [eventId, draftEventId] } } }).catch(() => {});
    await prisma.venue.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.organization.deleteMany({ where: { id: org.id } }).catch(() => {});
    await cleanupStaff(emails);
  });

  it('a FREE form starts blank with no business step; explicit questions are kept', async () => {
    const blank = await request(app).post(forms()).set(...auth()).send({ kind: 'FREE', name: 'Blank crew' });
    expect(blank.status).toBe(201);
    expect(blank.body).toMatchObject({ collectBusiness: false, questions: [] });
    expect(blank.body).not.toHaveProperty('purpose');
    const days = ['Friday', 'Saturday', 'Sunday'];
    const res = await request(app).post(forms()).set(...auth()).send({
      kind: 'FREE',
      name: 'Crew',
      collectBusiness: false,
      questions: [
        { label: 'Which days are you available?', type: 'MULTI_CHOICE', required: true, options: days },
        { label: 'Which roles interest you?', type: 'MULTI_CHOICE', required: false, options: ['Setup', 'Front door'] },
        { label: 'T-shirt size', type: 'SINGLE_CHOICE', required: false, options: ['S', 'M', 'L'] },
        { label: 'Emergency contact (name and phone)', type: 'SHORT_TEXT', required: true },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ collectBusiness: false });
    expect(res.body.questions.map((q) => q.label)).toEqual([
      'Which days are you available?',
      'Which roles interest you?',
      'T-shirt size',
      'Emergency contact (name and phone)',
    ]);
    volunteer = res.body;
  });

  it('any form may be PAID; a stale purpose from an old browser is ignored', async () => {
    const paid = await request(app).post(forms()).set(...auth()).send({ kind: 'PAID', purpose: 'VOLUNTEER', name: 'Paid crew' });
    expect(paid.status).toBe(201);
    expect(paid.body).not.toHaveProperty('purpose');
    // Spec 056: a paid form may skip business details.
    const noBiz = await request(app).post(forms()).set(...auth()).send({ kind: 'PAID', name: 'Vendors', collectBusiness: false });
    expect(noBiz.status).toBe(201);
    expect(noBiz.body.collectBusiness).toBe(false);
    const patched = await request(app).patch(`${forms()}/${paid.body.id}`).set(...auth()).send({ purpose: 'ROADIE', intro: 'Hi' });
    expect(patched.status).toBe(200);
    expect(patched.body.intro).toBe('Hi');
  });

  it('a FREE form submits without the business step', async () => {
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

  it('a blank form asks for an email only: no name is needed, and a name form still requires one (spec 056)', async () => {
    const blank = await request(app).post(forms()).set(...auth()).send({ kind: 'FREE', name: 'Press list', setup: true });
    expect(blank.body).toMatchObject({ collectName: false, collectBusiness: false });
    expect((await request(app).patch(`${forms()}/${blank.body.id}`).set(...auth()).send({ status: 'OPEN' })).status).toBe(200);
    const submit = (contact) =>
      request(app).post(`/events/${eventId}/applications`).send({ formSlug: blank.body.slug, contact, acceptances: allAcceptances(), answers: {} });
    const res = await submit({ email: `press@${TAG}.test` });
    expect(res.status).toBe(201);
    const row = await prisma.application.findUnique({ where: { id: res.body.applicationId }, include: { contact: true } });
    expect(row.contact).toMatchObject({ email: `press@${TAG}.test`, firstName: '', lastName: '' });
    // Adding the Name field makes it required again.
    expect((await request(app).patch(`${forms()}/${blank.body.id}`).set(...auth()).send({ collectName: true })).body.collectName).toBe(true);
    expect((await submit({ email: `press2@${TAG}.test` })).status).toBe(400);
    // Back to a draft so the public-list test below sees only its own form.
    await request(app).patch(`${forms()}/${blank.body.id}`).set(...auth()).send({ status: 'DRAFT' });
  });

  it('admin list and public forms carry the form, without a purpose', async () => {
    const admin = await request(app).get(forms()).set(...auth());
    expect(admin.status).toBe(200);
    expect(admin.body.data.find((f) => f.id === volunteer.id)).not.toHaveProperty('purpose');
    const pub = await request(app).get(`/events/${eventId}/applications/forms`);
    expect(pub.status).toBe(200);
    expect(pub.body.data).toEqual([expect.objectContaining({ id: volunteer.id, collectBusiness: false })]);
    expect(pub.body.data[0]).not.toHaveProperty('purpose');
  });

  it('the preview payload includes the draft event\'s DRAFT forms', async () => {
    expect((await request(app).post(forms(draftEventId)).set(...auth()).send({ kind: 'FREE', name: 'Crew 2' })).status).toBe(201);
    const res = await request(app).get(`/organizations/${org.id}/events/${draftEventId}/preview-payload`).set(...auth());
    expect(res.status).toBe(200);
    expect(res.body.forms).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Crew 2', acceptance: { open: false, reason: 'not_published' } })]));
  });
});
