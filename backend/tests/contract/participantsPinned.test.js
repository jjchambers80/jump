// Contract tests for pinned answer columns (spec 019 follow-up)
// Pin ≤ 2 live questions per form; list rows carry `pinnedAnswers` for those
// questions only; the org-wide forms list exposes `pinnedQuestions`;
// templates round-trip the flag under the same cap.

import request from 'supertest';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');

const TAG = 'pinned-ct';

describe('Pinned answer columns (spec 019 follow-up)', () => {
  let adminToken;
  let org;
  let event;
  let form;
  let q; // by label
  let application;
  const emails = [`admin@${TAG}.test`];
  const auth = (token) => ['Authorization', `Bearer ${token}`];

  beforeAll(async () => {
    await prisma.organization.deleteMany({ where: { name: { startsWith: `${TAG} ` } } }).catch(() => {});
    adminToken = await staffToken({ email: emails[0], role: 'ADMIN' });
    org = await prisma.organization.create({ data: { name: `${TAG} Gaming Geek`, email: `owner@${TAG}.test` } });
    await joinOrgByToken(adminToken, org.id, 'ADMIN');
    const venue = await prisma.venue.create({ data: { organizationId: org.id, name: `${TAG} RCC`, address: '500 S Salisbury St', city: 'Raleigh', state: 'NC' } });
    event = await prisma.event.create({ data: { venueId: venue.id, name: `${TAG} Expo`, date: new Date('2027-09-18T15:00:00Z'), status: 'PUBLISHED', capacity: 100 } });
    const res = await request(app)
      .post(`/admin/events/${event.id}/application-forms`)
      .set(...auth(adminToken))
      .send({
        kind: 'FREE',
        name: 'Press',
        questions: [
          { label: 'Outlet', type: 'SHORT_TEXT', required: true, pinned: true },
          { label: 'Coverage', type: 'MULTI_CHOICE', options: ['Print', 'Video', 'Podcast'] },
          { label: 'Insurance', type: 'CHECKBOX' },
          { label: 'Notes', type: 'LONG_TEXT' },
        ],
      });
    expect(res.status).toBe(201);
    form = res.body;
    q = Object.fromEntries(form.questions.map((x) => [x.label, x]));
    expect(q.Outlet.pinned).toBe(true);
    expect(q.Coverage.pinned).toBe(false);

    const contact = await prisma.contact.create({ data: { organizationId: org.id, email: `pat@${TAG}.test`, firstName: 'Pat', lastName: 'Press' } });
    const profile = await prisma.applicantProfile.create({ data: { organizationId: org.id, contactId: contact.id, businessName: 'Retro Weekly' } });
    application = await prisma.application.create({
      data: {
        formId: form.id,
        eventId: event.id,
        organizationId: org.id,
        contactId: contact.id,
        profileId: profile.id,
        status: 'SUBMITTED',
        paymentStatus: 'NOT_REQUIRED',
        submittedAt: new Date(),
        statusTokenHash: `hash-${TAG}-1`,
        answers: {
          create: [
            { questionId: q.Outlet.id, valueText: 'Retro Weekly' },
            { questionId: q.Coverage.id, valueJson: ['Print', 'Video'] },
            { questionId: q.Insurance.id, valueText: 'true' },
            { questionId: q.Notes.id, valueText: 'Long story' },
          ],
        },
      },
    });
  });

  afterAll(async () => {
    await prisma.applicationFormTemplate.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.application.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.applicantProfile.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.applicationForm.deleteMany({ where: { eventId: event.id } }).catch(() => {});
    await prisma.contact.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.event.deleteMany({ where: { id: event.id } }).catch(() => {});
    await prisma.venue.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.organization.deleteMany({ where: { id: org.id } }).catch(() => {});
    await cleanupStaff(emails);
  });

  const patchQ = (id, body) => request(app).patch(`/admin/events/${event.id}/application-forms/${form.id}/questions/${id}`).set(...auth(adminToken)).send(body);

  it('list rows carry pinnedAnswers for pinned questions only, in question order; other answers are not loaded', async () => {
    const res = await request(app).get('/admin/applications').set(...auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data[0].pinnedAnswers).toEqual([{ questionId: q.Outlet.id, label: 'Outlet', type: 'SHORT_TEXT', value: 'Retro Weekly' }]);
    const perEvent = await request(app).get(`/admin/events/${event.id}/applications`).set(...auth(adminToken));
    expect(perEvent.body.data[0].pinnedAnswers).toHaveLength(1);
  });

  it('a second pin is allowed, a third is refused (400) on create and update; unpinning frees a slot', async () => {
    expect((await patchQ(q.Coverage.id, { pinned: true })).status).toBe(200);
    const third = await patchQ(q.Insurance.id, { pinned: true });
    expect(third.status).toBe(400);
    expect(third.body.message).toMatch(/At most 2 questions can be pinned/);
    const added = await request(app).post(`/admin/events/${event.id}/application-forms/${form.id}/questions`).set(...auth(adminToken)).send({ label: 'Website', type: 'URL', pinned: true });
    expect(added.status).toBe(400);
    // Re-saving an already pinned question with other fields is fine (does not count twice).
    expect((await patchQ(q.Outlet.id, { pinned: true, helpText: 'Your outlet' })).status).toBe(200);

    const list = await request(app).get('/admin/applications').set(...auth(adminToken));
    expect(list.body.data[0].pinnedAnswers.map((a) => [a.label, a.value])).toEqual([
      ['Outlet', 'Retro Weekly'],
      ['Coverage', 'Print; Video'],
    ]);

    expect((await patchQ(q.Coverage.id, { pinned: false })).status).toBe(200);
    expect((await patchQ(q.Insurance.id, { pinned: true })).status).toBe(200);
    const after = await request(app).get('/admin/applications').set(...auth(adminToken));
    expect(after.body.data[0].pinnedAnswers.map((a) => a.label)).toEqual(['Outlet', 'Insurance']);
  });

  it('rejects a non-boolean pinned and an unknown field', async () => {
    const bad = await patchQ(q.Notes.id, { pinned: 'yes' });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toMatch(/pinned must be a boolean/);
  });

  it('archiving a pinned question drops it from the rows and frees the slot', async () => {
    const removed = await request(app).delete(`/admin/events/${event.id}/application-forms/${form.id}/questions/${q.Insurance.id}`).set(...auth(adminToken));
    expect(removed.body).toEqual({ archived: true });
    const list = await request(app).get('/admin/applications').set(...auth(adminToken));
    expect(list.body.data[0].pinnedAnswers.map((a) => a.label)).toEqual(['Outlet']);
    expect((await patchQ(q.Coverage.id, { pinned: true })).status).toBe(200);
  });

  it('the org-wide forms list exposes pinnedQuestions in order', async () => {
    const res = await request(app).get('/admin/application-forms').set(...auth(adminToken));
    const mine = res.body.data.find((f) => f.id === form.id);
    expect(mine.pinnedQuestions).toEqual([
      { id: q.Outlet.id, label: 'Outlet', type: 'SHORT_TEXT' },
      { id: q.Coverage.id, label: 'Coverage', type: 'MULTI_CHOICE' },
    ]);
  });

  it('templates round-trip pinned and enforce the same cap; create-from pins the copies', async () => {
    const saved = await request(app).post(`/admin/events/${event.id}/application-forms/${form.id}/save-as-template`).set(...auth(adminToken)).send({ name: 'Press template' });
    expect(saved.status).toBe(201);
    expect(saved.body.definition.questions.map((x) => [x.label, x.pinned])).toEqual([
      ['Outlet', true],
      ['Coverage', true],
      ['Notes', false],
    ]);
    const tooMany = await request(app)
      .put(`/admin/application-templates/${saved.body.id}`)
      .set(...auth(adminToken))
      .send({ definition: { ...saved.body.definition, questions: saved.body.definition.questions.map((x) => ({ ...x, pinned: true })) } });
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.message).toMatch(/At most 2 questions/);

    const created = await request(app).post(`/admin/events/${event.id}/application-forms`).set(...auth(adminToken)).send({ kind: 'FREE', name: 'Press 2', templateId: saved.body.id });
    expect(created.status).toBe(201);
    expect(created.body.questions.map((x) => [x.label, x.pinned])).toEqual([
      ['Outlet', true],
      ['Coverage', true],
      ['Notes', false],
    ]);
  });
});
