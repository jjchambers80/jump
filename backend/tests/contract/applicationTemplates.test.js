// Contract tests for application form templates (spec 019 phase 2)
// RBAC, validation parity with the form editor, save-as (new / replace),
// create-from (settings, tiers, questions, kind mismatch, other org),
// template edits independent of created forms, copyForms still green.

import request from 'supertest';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');
const { default: applicationFormService } = await import('../../src/services/ApplicationFormService.js');

const TAG = 'form-tpl-ct';

describe('Application form templates (spec 019 phase 2)', () => {
  let adminToken;
  let organizerToken;
  let adminBToken;
  let sysToken;
  let org;
  let orgB;
  let expo;
  let con;
  let vendorForm;
  let template; // saved from vendorForm
  const emails = [`admin@${TAG}.test`, `organizer@${TAG}.test`, `admin-b@${TAG}.test`, `sys@${TAG}.test`];
  const auth = (token) => ['Authorization', `Bearer ${token}`];

  beforeAll(async () => {
    await prisma.organization.deleteMany({ where: { name: { startsWith: `${TAG} ` } } }).catch(() => {});
    adminToken = await staffToken({ email: emails[0], role: 'ADMIN' });
    organizerToken = await staffToken({ email: emails[1], role: 'ORGANIZER' });
    adminBToken = await staffToken({ email: emails[2], role: 'ADMIN' });
    sysToken = await staffToken({ email: emails[3], role: 'SYSTEM_ADMIN' });
    org = await prisma.organization.create({ data: { name: `${TAG} Gaming Geek`, email: `owner@${TAG}.test` } });
    orgB = await prisma.organization.create({ data: { name: `${TAG} Other Org` } });
    await joinOrgByToken(adminToken, org.id, 'ADMIN');
    await joinOrgByToken(organizerToken, org.id, 'ORGANIZER');
    await joinOrgByToken(adminBToken, orgB.id, 'ADMIN');
    const venue = await prisma.venue.create({ data: { organizationId: org.id, name: `${TAG} RCC`, address: '500 S Salisbury St', city: 'Raleigh', state: 'NC' } });
    expo = await prisma.event.create({ data: { venueId: venue.id, name: `${TAG} Expo 2027`, date: new Date('2027-09-18T15:00:00Z'), status: 'PUBLISHED', capacity: 1000, taxRate: 0.0725 } });
    con = await prisma.event.create({ data: { venueId: venue.id, name: `${TAG} Winter Con`, date: new Date('2027-01-10T15:00:00Z'), status: 'DRAFT', capacity: 500 } });

    const res = await request(app)
      .post(`/admin/events/${expo.id}/application-forms`)
      .set(...auth(adminToken))
      .send({
        kind: 'PAID',
        name: 'Vendor Space',
        intro: 'Sell your wares.',
        feeMode: 'ABSORB',
        chargeTiming: 'APPROVAL',
        paymentDueDays: 10,
        overduePolicy: 'HOLD',
        taxable: true,
        tiers: [
          { name: '10x10', price: 275, quantityTotal: 5 },
          { name: 'Corner', description: 'Two open sides', price: 350, quantityTotal: 2, isActive: false },
        ],
        questions: [
          { label: 'What do you sell?', type: 'LONG_TEXT', required: true },
          { label: 'Booth style', type: 'SINGLE_CHOICE', options: ['Table', 'Pipe & drape'] },
          { label: 'Old question', type: 'SHORT_TEXT' },
        ],
      });
    expect(res.status).toBe(201);
    vendorForm = res.body;
    // Archive the third question so save-as skips it.
    const old = vendorForm.questions[2];
    await prisma.applicationQuestion.update({ where: { id: old.id }, data: { archivedAt: new Date() } });
  });

  afterAll(async () => {
    for (const o of [org, orgB]) {
      await prisma.applicationFormTemplate.deleteMany({ where: { organizationId: o.id } }).catch(() => {});
      await prisma.applicationForm.deleteMany({ where: { event: { venue: { organizationId: o.id } } } }).catch(() => {});
      await prisma.event.deleteMany({ where: { venue: { organizationId: o.id } } }).catch(() => {});
      await prisma.venue.deleteMany({ where: { organizationId: o.id } }).catch(() => {});
    }
    await prisma.organization.deleteMany({ where: { id: { in: [org.id, orgB.id] } } }).catch(() => {});
    await cleanupStaff(emails);
  });

  // ─── Save as ──────────────────────────────────────────────────────────────

  describe('save-as-template', () => {
    it('ADMIN snapshots a form: settings, tiers without add-ons, non-archived questions; ORGANIZER is refused', async () => {
      const forbidden = await request(app).post(`/admin/events/${expo.id}/application-forms/${vendorForm.id}/save-as-template`).set(...auth(organizerToken)).send({ name: 'Nope' });
      expect(forbidden.status).toBe(403);

      const res = await request(app).post(`/admin/events/${expo.id}/application-forms/${vendorForm.id}/save-as-template`).set(...auth(adminToken)).send({ name: 'Exhibitor booths' });
      expect(res.status).toBe(201);
      template = res.body;
      expect(template).toMatchObject({ organizationId: org.id, name: 'Exhibitor booths', kind: 'PAID', sourceFormId: vendorForm.id });
      expect(template.definition).toEqual({
        intro: 'Sell your wares.',
        chargeTiming: 'APPROVAL',
        feeMode: 'ABSORB',
        taxable: true,
        paymentDueDays: 10,
        overduePolicy: 'HOLD',
        tiers: [
          { name: '10x10', description: null, price: 275, quantityTotal: 5, isActive: true },
          { name: 'Corner', description: 'Two open sides', price: 350, quantityTotal: 2, isActive: false },
        ],
        questions: [
          { label: 'What do you sell?', helpText: null, type: 'LONG_TEXT', required: true, options: [] },
          { label: 'Booth style', helpText: null, type: 'SINGLE_CHOICE', required: false, options: ['Table', 'Pipe & drape'] },
        ],
      });
    });

    it('a second save with the same name is a 409; replaceTemplateId overwrites the definition', async () => {
      const dup = await request(app).post(`/admin/events/${expo.id}/application-forms/${vendorForm.id}/save-as-template`).set(...auth(adminToken)).send({ name: 'Exhibitor booths' });
      expect(dup.status).toBe(409);
      expect(dup.body.message).toMatch(/already exists/);

      await request(app).patch(`/admin/events/${expo.id}/application-forms/${vendorForm.id}`).set(...auth(adminToken)).send({ intro: 'Updated intro.' });
      const replaced = await request(app).post(`/admin/events/${expo.id}/application-forms/${vendorForm.id}/save-as-template`).set(...auth(adminToken)).send({ replaceTemplateId: template.id });
      expect(replaced.status).toBe(200);
      expect(replaced.body.id).toBe(template.id);
      expect(replaced.body.definition.intro).toBe('Updated intro.');
      template = replaced.body;
    });

    it('validates the body', async () => {
      const res = await request(app).post(`/admin/events/${expo.id}/application-forms/${vendorForm.id}/save-as-template`).set(...auth(adminToken)).send({});
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/name is required/);
    });
  });

  // ─── CRUD + RBAC ──────────────────────────────────────────────────────────

  describe('templates CRUD', () => {
    it('ORGANIZER lists and reads; only ADMIN writes; other organizations and no-membership staff see nothing', async () => {
      const list = await request(app).get('/admin/application-templates').set(...auth(organizerToken));
      expect(list.status).toBe(200);
      expect(list.body.data).toEqual([expect.objectContaining({ id: template.id, name: 'Exhibitor booths', kind: 'PAID', tierCount: 2, questionCount: 2 })]);
      expect(list.body.data[0].definition).toBeUndefined();

      const read = await request(app).get(`/admin/application-templates/${template.id}`).set(...auth(organizerToken));
      expect(read.status).toBe(200);
      expect(read.body.definition.tiers).toHaveLength(2);

      expect((await request(app).post('/admin/application-templates').set(...auth(organizerToken)).send({ name: 'X', kind: 'FREE' })).status).toBe(403);
      expect((await request(app).put(`/admin/application-templates/${template.id}`).set(...auth(organizerToken)).send({ name: 'Y' })).status).toBe(403);
      expect((await request(app).delete(`/admin/application-templates/${template.id}`).set(...auth(organizerToken))).status).toBe(403);

      expect((await request(app).get('/admin/application-templates').set(...auth(adminBToken))).body.data).toEqual([]);
      expect((await request(app).get(`/admin/application-templates/${template.id}`).set(...auth(adminBToken))).status).toBe(404);
      expect((await request(app).put(`/admin/application-templates/${template.id}`).set(...auth(adminBToken)).send({ name: 'Stolen' })).status).toBe(404);

      const orphan = await staffToken({ email: `orphan@${TAG}.test`, role: 'ADMIN' });
      expect((await request(app).get('/admin/application-templates').set(...auth(orphan))).body).toEqual({ data: [] });
      expect((await request(app).get(`/admin/application-templates/${template.id}`).set(...auth(orphan))).status).toBe(404);
      await cleanupStaff([`orphan@${TAG}.test`]);
    });

    it('SYSTEM_ADMIN lists every organization with the organization on each row and creates with X-Jump-Org', async () => {
      const list = await request(app).get('/admin/application-templates').set(...auth(sysToken));
      const mine = list.body.data.find((t) => t.id === template.id);
      expect(mine.organization).toEqual({ id: org.id, name: org.name });

      const created = await request(app).post('/admin/application-templates').set(...auth(sysToken)).set('X-Jump-Org', orgB.id).send({ name: 'Press pass', kind: 'FREE' });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ organizationId: orgB.id, kind: 'FREE', definition: { intro: null, chargeTiming: null, tiers: [], questions: [] } });
      expect((await request(app).get('/admin/application-templates').set(...auth(adminBToken))).body.data.map((t) => t.name)).toEqual(['Press pass']);
    });

    it('ADMIN creates an empty template, updates name and definition, and a name collision is 409', async () => {
      const created = await request(app).post('/admin/application-templates').set(...auth(adminToken)).send({ name: 'Panel proposals', kind: 'FREE' });
      expect(created.status).toBe(201);
      expect(created.body.definition).toEqual({ intro: null, chargeTiming: null, feeMode: null, taxable: null, paymentDueDays: null, overduePolicy: null, tiers: [], questions: [] });

      const updated = await request(app)
        .put(`/admin/application-templates/${created.body.id}`)
        .set(...auth(adminToken))
        .send({ name: 'Panels', definition: { intro: 'Pitch a panel.', questions: [{ label: 'Panel title', type: 'SHORT_TEXT', required: true }, { label: 'Format', type: 'MULTI_CHOICE', options: ['Talk', 'Q&A', 'Workshop'] }] } });
      expect(updated.status).toBe(200);
      expect(updated.body.name).toBe('Panels');
      expect(updated.body.definition.questions.map((q) => q.label)).toEqual(['Panel title', 'Format']);
      expect(updated.body.definition.questions[1].options).toEqual(['Talk', 'Q&A', 'Workshop']);

      const clash = await request(app).put(`/admin/application-templates/${created.body.id}`).set(...auth(adminToken)).send({ name: 'Exhibitor booths' });
      expect(clash.status).toBe(409);

      const kindChange = await request(app).put(`/admin/application-templates/${created.body.id}`).set(...auth(adminToken)).send({ kind: 'PAID' });
      expect(kindChange.status).toBe(400);
      expect(kindChange.body.message).toMatch(/kind cannot change/);
    });

    it.each([
      ['a bad tier price', 'PAID', { tiers: [{ name: '10x10', price: -5, quantityTotal: 1 }] }, /tier price must be between 0 and 100000/],
      ['tiers on a FREE template', 'FREE', { tiers: [{ name: 'x', price: 1, quantityTotal: 1 }] }, /FREE forms cannot have tiers/],
      ['a choice question with one option', 'FREE', { questions: [{ label: 'Pick', type: 'SINGLE_CHOICE', options: ['only'] }] }, /at least two options/],
      ['an unknown question type', 'FREE', { questions: [{ label: 'Pick', type: 'DATE' }] }, /question type must be one of/],
      ['paymentDueDays out of range', 'PAID', { paymentDueDays: 99 }, /paymentDueDays must be 1-30/],
      ['a PAID-only setting on FREE', 'FREE', { feeMode: 'ABSORB' }, /PAID forms only/],
      ['an unknown definition field', 'FREE', { slug: 'x' }, /Unknown definition field: slug/],
      ['an unknown tier field', 'PAID', { tiers: [{ name: 'x', price: 1, quantityTotal: 1, addOnIds: [] }] }, /Unknown tier field: addOnIds/],
      ['too many questions', 'FREE', { questions: Array.from({ length: 101 }, (_, i) => ({ label: `Q${i}`, type: 'SHORT_TEXT' })) }, /at most 100 questions/],
    ])('rejects %s with the form validator message', async (_label, kind, definition, message) => {
      const res = await request(app).post('/admin/application-templates').set(...auth(adminToken)).send({ name: `Bad ${_label}`, kind, definition });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(message);
    });
  });

  // ─── Create form from template ────────────────────────────────────────────

  describe('create form from template', () => {
    let createdForm;

    it('creates a DRAFT form with no window, tiers at full quantity, questions in order, back-reference set; body fields win over template settings', async () => {
      const res = await request(app)
        .post(`/admin/events/${con.id}/application-forms`)
        .set(...auth(adminToken))
        .send({ kind: 'PAID', name: 'Winter vendors', templateId: template.id, paymentDueDays: 3 });
      expect(res.status).toBe(201);
      createdForm = res.body;
      expect(createdForm).toMatchObject({
        eventId: con.id,
        kind: 'PAID',
        name: 'Winter vendors',
        slug: 'winter-vendors',
        status: 'DRAFT',
        opensAt: null,
        closesAt: null,
        intro: 'Updated intro.',
        chargeTiming: 'APPROVAL',
        feeMode: 'ABSORB',
        taxable: true,
        paymentDueDays: 3,
        overduePolicy: 'HOLD',
        createdFromTemplateId: template.id,
      });
      expect(createdForm.tiers.map((t) => [t.name, t.price, t.quantityTotal, t.quantityReserved ?? 0, t.isActive])).toEqual([
        ['10x10', 275, 5, 0, true],
        ['Corner', 350, 2, 0, false],
      ]);
      expect(createdForm.questions.map((q) => q.label)).toEqual(['What do you sell?', 'Booth style']);
      expect(createdForm.questions[1].options).toEqual(['Table', 'Pipe & drape']);
      expect(createdForm.tiers[0].addOnIds ?? createdForm.tiers[0].addOns ?? []).toEqual([]);
    });

    it('refuses a kind mismatch, tiers/questions alongside a template, a template from another organization, and a missing template', async () => {
      const mismatch = await request(app).post(`/admin/events/${con.id}/application-forms`).set(...auth(adminToken)).send({ kind: 'FREE', name: 'Wrong kind', templateId: template.id });
      expect(mismatch.status).toBe(400);
      expect(mismatch.body.message).toMatch(/is for PAID forms/);

      const both = await request(app).post(`/admin/events/${con.id}/application-forms`).set(...auth(adminToken)).send({ kind: 'PAID', name: 'Both', templateId: template.id, questions: [] });
      expect(both.status).toBe(400);
      expect(both.body.message).toMatch(/come from the template/);

      const other = await request(app).post(`/admin/events/${con.id}/application-forms`).set(...auth(adminToken)).send({ kind: 'FREE', name: 'Theirs', templateId: (await prisma.applicationFormTemplate.findFirst({ where: { organizationId: orgB.id } })).id });
      expect(other.status).toBe(404);

      const missing = await request(app).post(`/admin/events/${con.id}/application-forms`).set(...auth(adminToken)).send({ kind: 'PAID', name: 'Ghost', templateId: 'nope' });
      expect(missing.status).toBe(404);
      expect(await prisma.applicationForm.count({ where: { eventId: con.id } })).toBe(1);
    });

    it('editing the template afterwards does not touch the created form, and deleting it keeps the back-reference', async () => {
      await request(app).put(`/admin/application-templates/${template.id}`).set(...auth(adminToken)).send({ definition: { ...template.definition, intro: 'Changed later', questions: [] } });
      const form = await request(app).get(`/admin/events/${con.id}/application-forms/${createdForm.id}`).set(...auth(adminToken));
      expect(form.body.intro).toBe('Updated intro.');
      expect(form.body.questions).toHaveLength(2);

      const del = await request(app).delete(`/admin/application-templates/${template.id}`).set(...auth(adminToken));
      expect(del.status).toBe(204);
      expect((await request(app).get(`/admin/application-templates/${template.id}`).set(...auth(adminToken))).status).toBe(404);
      const after = await prisma.applicationForm.findUnique({ where: { id: createdForm.id }, select: { createdFromTemplateId: true } });
      expect(after.createdFromTemplateId).toBe(template.id);
    });

    it('copyForms (event duplication) still copies tiers and questions through _materialise, carrying the back-reference', async () => {
      const copyEvent = await prisma.event.create({ data: { venueId: (await prisma.venue.findFirst({ where: { organizationId: org.id } })).id, name: `${TAG} Copy`, date: new Date('2028-01-01T15:00:00Z'), status: 'DRAFT', capacity: 10 } });
      const { copied, tierIdMap } = await prisma.$transaction((tx) => applicationFormService.copyForms(con.id, copyEvent.id, tx));
      expect(copied).toBe(1);
      const copy = await prisma.applicationForm.findFirst({ where: { eventId: copyEvent.id }, include: { tiers: { orderBy: { displayOrder: 'asc' } }, questions: { orderBy: { displayOrder: 'asc' } } } });
      expect(copy.createdFromTemplateId).toBe(template.id);
      expect(copy.tiers.map((t) => t.name)).toEqual(['10x10', 'Corner']);
      expect(copy.questions.map((q) => q.label)).toEqual(['What do you sell?', 'Booth style']);
      expect([...tierIdMap.values()]).toEqual(copy.tiers.map((t) => t.id));
    });
  });
});
