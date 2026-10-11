// Contract test for 050-E (spec 050 §7.3, decision 10): ORGANIZER configures
// event application forms, form templates and add-ons; money movement,
// settings writes and standing forms stay ADMIN. One table per outcome, every
// row hit by ORGANIZER, ADMIN and UNASSIGNED, so a new route added to either
// list keeps the boundary honest.

import request from 'supertest';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');
const { default: permissionService } = await import('../../src/services/PermissionService.js');

const TAG = `org-form-cfg-${process.pid}-${Date.now()}`;
const emails = [`admin@${TAG}.test`, `organizer@${TAG}.test`, `unassigned@${TAG}.test`, `outsider@${TAG}.test`];
const FAKE = 'cl0000000000000000000000';
// Placeholder ids for test titles only.
const PATHS = Object.fromEntries(['orgId', 'eventId', 'formId', 'tierId', 'questionId', 'addOnId', 'savedAddOnId', 'templateId'].map((k) => [k, `:${k}`]));

// Open to ORGANIZER (plan §7.3). Each row gets fresh fixtures from `fresh()`.
const OPENED = [
  ['POST', (f) => `/admin/events/${f.eventId}/application-forms`, () => ({ kind: 'FREE', name: 'Press' }), 201],
  ['PATCH', (f) => `/admin/events/${f.eventId}/application-forms/${f.formId}`, () => ({ name: 'Renamed' }), 200],
  ['DELETE', (f) => `/admin/events/${f.eventId}/application-forms/${f.formId}`, () => undefined, 204],
  ['POST', (f) => `/admin/events/${f.eventId}/application-forms/${f.formId}/save-as-template`, (f) => ({ name: `Saved ${f.n}` }), 201],
  ['POST', (f) => `/admin/events/${f.eventId}/application-forms/${f.formId}/tiers`, () => ({ name: 'Corner', price: 150, quantityTotal: 2 }), 201],
  ['PATCH', (f) => `/admin/events/${f.eventId}/application-forms/${f.formId}/tiers/${f.tierId}`, () => ({ name: 'Inline' }), 200],
  ['DELETE', (f) => `/admin/events/${f.eventId}/application-forms/${f.formId}/tiers/${f.tierId}`, () => undefined, 204],
  ['PUT', (f) => `/admin/events/${f.eventId}/application-forms/${f.formId}/tiers/${f.tierId}/add-ons`, () => ({ addOnIds: [] }), 200],
  ['POST', (f) => `/admin/events/${f.eventId}/application-forms/${f.formId}/questions`, () => ({ label: 'Website', type: 'SHORT_TEXT' }), 201],
  ['PATCH', (f) => `/admin/events/${f.eventId}/application-forms/${f.formId}/questions/reorder`, (f) => ({ ids: [f.questionId] }), 200],
  ['PATCH', (f) => `/admin/events/${f.eventId}/application-forms/${f.formId}/questions/${f.questionId}`, () => ({ label: 'Outlet' }), 200],
  ['DELETE', (f) => `/admin/events/${f.eventId}/application-forms/${f.formId}/questions/${f.questionId}`, () => undefined, 200],
  ['POST', () => '/admin/application-templates', (f) => ({ name: `Template ${f.n}`, kind: 'FREE' }), 201],
  ['PUT', (f) => `/admin/application-templates/${f.templateId}`, (f) => ({ name: `Renamed ${f.n}` }), 200],
  ['DELETE', (f) => `/admin/application-templates/${f.templateId}`, () => undefined, 204],
  ['POST', (f) => `/organizations/${f.orgId}/events/${f.eventId}/add-ons`, (f) => ({ name: `Parking ${f.n}`, price: 15, scope: 'TICKET' }), 201],
  ['POST', (f) => `/organizations/${f.orgId}/events/${f.eventId}/add-ons/attach`, (f) => ({ productId: f.savedAddOnId }), 201],
  ['POST', (f) => `/organizations/${f.orgId}/events/${f.eventId}/add-ons/reorder`, (f) => ({ addOnIds: [...f.eventAddOnIds].reverse() }), 200],
  ['PATCH', (f) => `/organizations/${f.orgId}/events/${f.eventId}/add-ons/${f.addOnId}`, () => ({ price: 20 }), 200],
  ['POST', (f) => `/organizations/${f.orgId}/events/${f.eventId}/add-ons/${f.addOnId}/deactivate`, () => ({}), 200],
  ['POST', (f) => `/organizations/${f.orgId}/events/${f.eventId}/add-ons/${f.addOnId}/activate`, () => ({}), 200],
  ['DELETE', (f) => `/organizations/${f.orgId}/events/${f.eventId}/add-ons/${f.addOnId}`, () => undefined, 200],
  ['POST', (f) => `/organizations/${f.orgId}/saved-add-ons`, (f) => ({ name: `Power ${f.n}`, defaultPrice: 50 }), 201],
  ['PATCH', (f) => `/organizations/${f.orgId}/saved-add-ons/${f.savedAddOnId}`, () => ({ defaultPrice: 60 }), 200],
  ['POST', (f) => `/organizations/${f.orgId}/saved-add-ons/${f.savedAddOnId}/archive`, () => ({}), 200],
  ['POST', (f) => `/organizations/${f.orgId}/saved-add-ons/${f.savedAddOnId}/unarchive`, () => ({}), 200],
];

// Kept ADMIN. Fake ids: ADMIN passes the guard and fails later (400/404),
// which is all these rows assert — they never move money or change settings.
const KEPT_ADMIN = [
  ['POST', (f) => `/admin/events/${f.eventId}/applications/${FAKE}/refund`, () => ({ amount: 1 })],
  ['POST', (f) => `/admin/events/${f.eventId}/applications/${FAKE}/waive`, () => ({})],
  ['POST', (f) => `/admin/events/${f.eventId}/applications/${FAKE}/offline-payment`, () => ({})],
  ['POST', () => `/admin/orders/${FAKE}/refund`, () => ({})],
  ['POST', () => `/admin/tickets/${FAKE}/refund`, () => ({})],
  ['POST', () => `/admin/orders/${FAKE}/add-ons/${FAKE}/refund`, () => ({})],
  ['PATCH', (f) => `/organizations/${f.orgId}`, () => ({ name: '' })],
  ['PATCH', () => '/admin/settings/tax', () => ({ collecting: 'nope' })],
  ['PATCH', () => '/admin/settings/payments', () => ({ statementDescriptorSuffix: 42 })],
  ['PUT', () => '/admin/settings/application-templates/not-an-action', () => ({})],
  ['DELETE', () => '/admin/settings/application-templates/not-an-action', () => undefined],
  ['PATCH', () => '/admin/settings/application-digest', () => ({ enabled: 'nope' })],
  ['POST', () => '/admin/settings/users', () => ({})],
  ['POST', () => '/admin/standing-application-forms', () => ({})],
  ['PATCH', () => `/admin/standing-application-forms/${FAKE}`, () => ({ name: 'x' })],
  ['DELETE', () => `/admin/standing-application-forms/${FAKE}`, () => undefined],
  ['POST', () => `/admin/standing-application-forms/${FAKE}/save-as-template`, () => ({ name: 'x' })],
  ['POST', () => `/admin/standing-application-forms/${FAKE}/questions`, () => ({ label: 'x', type: 'SHORT_TEXT' })],
  ['PATCH', () => `/admin/standing-application-forms/${FAKE}/questions/reorder`, () => ({ ids: [] })],
  ['PATCH', () => `/admin/standing-application-forms/${FAKE}/questions/${FAKE}`, () => ({ label: 'x' })],
  ['DELETE', () => `/admin/standing-application-forms/${FAKE}/questions/${FAKE}`, () => undefined],
];

// The catalog action guarding an opened row.
const keyOf = (label) => (label.includes(' /organizations/') ? 'addOns.manage' : 'applications.forms');
const pinRoles = (value) => {
  permissionService._cache = { at: Date.now() + 3_600_000, value: { ADMIN: {}, ORGANIZER: {}, disabled: [], ...value } };
};

describe('050-E: ORGANIZER configures forms and add-ons', () => {
  const tokens = {};
  let org;
  let otherOrg;
  let event;
  let n = 0;

  const call = (method, path, token, body) => {
    const req = request(app)[method.toLowerCase()](path).set('Authorization', `Bearer ${token}`).set('X-Jump-Org', org.id);
    return body === undefined ? req : req.send(body);
  };

  /** A form with one tier and one question, an add-on, a saved add-on and a form template, made by ADMIN. */
  async function fresh() {
    n += 1;
    const admin = tokens.ADMIN;
    const form = await call('POST', `/admin/events/${event.id}/application-forms`, admin, {
      kind: 'PAID',
      name: `Vendors ${n}`,
      tiers: [{ name: 'Table', price: 100, quantityTotal: 5 }],
      questions: [{ label: 'What do you sell?', type: 'SHORT_TEXT' }],
    });
    const addOn = await call('POST', `/organizations/${org.id}/events/${event.id}/add-ons`, admin, { name: `Shirt ${n}`, price: 25, scope: 'TICKET' });
    const saved = await call('POST', `/organizations/${org.id}/saved-add-ons`, admin, { name: `Wifi ${n}`, defaultPrice: 10 });
    const template = await call('POST', '/admin/application-templates', admin, { name: `Fixture ${n}`, kind: 'FREE' });
    for (const res of [form, addOn, saved, template]) expect([res.status, res.body]).toEqual([201, expect.anything()]);
    return {
      n,
      orgId: org.id,
      eventId: event.id,
      formId: form.body.id,
      tierId: form.body.tiers[0].id,
      questionId: form.body.questions[0].id,
      addOnId: addOn.body.id,
      savedAddOnId: saved.body.id,
      templateId: template.body.id,
      eventAddOnIds: (await prisma.addOn.findMany({ where: { eventId: event.id }, select: { id: true } })).map((a) => a.id),
    };
  }

  beforeAll(async () => {
    tokens.ADMIN = await staffToken({ email: emails[0], role: 'ADMIN' });
    tokens.ORGANIZER = await staffToken({ email: emails[1], role: 'ORGANIZER' });
    tokens.UNASSIGNED = await staffToken({ email: emails[2], role: 'UNASSIGNED' });
    // ORGANIZER of another organization: X-Jump-Org naming org A is not honoured.
    tokens.OUTSIDER = await staffToken({ email: emails[3], role: 'ORGANIZER' });
    org = await prisma.organization.create({ data: { name: `${TAG} Org`, email: `owner@${TAG}.test` } });
    otherOrg = await prisma.organization.create({ data: { name: `${TAG} Other` } });
    await joinOrgByToken(tokens.OUTSIDER, otherOrg.id, 'ORGANIZER');
    await joinOrgByToken(tokens.ADMIN, org.id, 'ADMIN');
    await joinOrgByToken(tokens.ORGANIZER, org.id, 'ORGANIZER');
    const venue = await prisma.venue.create({ data: { organizationId: org.id, name: `${TAG} Hall`, address: '1 Main St', city: 'Raleigh', state: 'NC' } });
    event = await prisma.event.create({ data: { venueId: venue.id, name: `${TAG} Expo`, date: new Date('2027-09-18T15:00:00Z'), status: 'DRAFT', capacity: 100 } });
  });

  // Catalog defaults, pinned in this worker's cache: suites share one database
  // and another may have stored overrides.
  beforeEach(() => pinRoles({}));

  afterAll(async () => {
    permissionService.clearCache();
    const where = { venue: { organizationId: org.id } };
    await prisma.applicationFormTemplate.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.applicationForm.deleteMany({ where: { event: where } }).catch(() => {});
    await prisma.addOn.deleteMany({ where: { event: where } }).catch(() => {});
    await prisma.addOnProduct.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.event.deleteMany({ where }).catch(() => {});
    await prisma.venue.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.organization.deleteMany({ where: { id: { in: [org.id, otherOrg.id] } } }).catch(() => {});
    await cleanupStaff(emails);
  });

  describe.each(OPENED.map((row) => [`${row[0]} ${row[1](PATHS)}`, ...row]))('%s (opened to ORGANIZER)', (_label, method, path, body, ok) => {
    test.each(['ORGANIZER', 'ADMIN'])(`%s gets ${ok}`, async (role) => {
      const f = await fresh();
      const res = await call(method, path(f), tokens[role], body(f));
      expect({ status: res.status, body: res.status === ok ? null : res.body }).toEqual({ status: ok, body: null });
    });

    test('UNASSIGNED gets 403', async () => {
      const f = await fresh();
      expect((await call(method, path(f), tokens.UNASSIGNED, body(f))).status).toBe(403);
    });

    test(`ORGANIZER gets 403 when System › Roles takes ${keyOf(_label)} away`, async () => {
      const f = await fresh();
      pinRoles({ ORGANIZER: { [keyOf(_label)]: false } });
      expect((await call(method, path(f), tokens.ORGANIZER, body(f))).status).toBe(403);
    });

    // Creating a template names no org A resource: an outsider's lands in their own org.
    if (_label !== 'POST /admin/application-templates') {
      test("another organization's ORGANIZER gets 403 or 404", async () => {
        const f = await fresh();
        expect([403, 404]).toContain((await call(method, path(f), tokens.OUTSIDER, body(f))).status);
      });
    }
  });

  describe('booth force-assign (maps.forceAssign)', () => {
    const apps = {};
    let map;
    let booths;

    beforeAll(async () => {
      const form = await prisma.applicationForm.create({
        data: { organizationId: org.id, eventId: event.id, name: `${TAG} Map form`, slug: `${TAG}-map`, kind: 'PAID', chargeTiming: 'APPROVAL', feeMode: 'ABSORB' },
      });
      const [tierA, tierB] = await Promise.all(
        ['A', 'B'].map((name) => prisma.applicationTier.create({ data: { formId: form.id, name, price: 50, quantityTotal: 5 } }))
      );
      const contact = await prisma.contact.create({ data: { organizationId: org.id, email: `vendor@${TAG}.test`, firstName: 'Vee', lastName: 'Ndor' } });
      const profile = await prisma.applicantProfile.create({ data: { organizationId: org.id, contactId: contact.id, businessName: `${TAG} Co` } });
      for (const role of ['ORGANIZER', 'ADMIN']) {
        apps[role] = await prisma.application.create({
          data: {
            eventId: event.id, organizationId: org.id, formId: form.id, tierId: tierA.id, contactId: contact.id, profileId: profile.id,
            status: 'APPROVED', capacitySlot: 'APPROVED', submittedAt: new Date(), statusTokenHash: `${TAG}-${role}`,
          },
        });
      }
      map = await prisma.floorMap.create({ data: { organizationId: org.id, eventId: event.id, name: 'Hall', width: 20, height: 20, layout: { version: 1, elements: [] } } });
      booths = await Promise.all(
        ['B1', 'B2', 'B3'].map((label, i) => prisma.booth.create({ data: { mapId: map.id, label, x: i * 2, y: 0, w: 1, h: 1, tierId: tierB.id } }))
      );
    });

    afterAll(async () => {
      await prisma.floorMap.deleteMany({ where: { id: map.id } }).catch(() => {});
      await prisma.application.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
      await prisma.applicantProfile.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
      await prisma.contact.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    });

    const assign = (role, booth, application, force) =>
      call('POST', `/admin/maps/${map.id}/booths/${booth.id}/assign`, tokens[role], { applicationId: application.id, force });

    test('ORGANIZER gets 403 forcing a category mismatch; without force the mismatch is a 400', async () => {
      expect((await assign('ORGANIZER', booths[0], apps.ORGANIZER, true)).status).toBe(403);
      const plain = await assign('ORGANIZER', booths[0], apps.ORGANIZER, false);
      expect([plain.status, plain.body.message]).toEqual([400, expect.stringMatching(/TIER_MISMATCH/)]);
    });

    test('ADMIN forces the assignment', async () => {
      const res = await assign('ADMIN', booths[1], apps.ADMIN, true);
      expect([res.status, res.body.status]).toEqual([200, 'SOLD']);
    });

    test('ORGANIZER may force once System › Roles grants maps.forceAssign', async () => {
      pinRoles({ ORGANIZER: { 'maps.forceAssign': true } });
      expect((await assign('ORGANIZER', booths[2], apps.ORGANIZER, true)).status).toBe(200);
    });
  });

  describe.each(KEPT_ADMIN.map((row) => [`${row[0]} ${row[1](PATHS)}`, ...row]))('%s (kept ADMIN)', (_label, method, path, body) => {
    const f = () => ({ orgId: org.id, eventId: event.id });

    test.each(['ORGANIZER', 'UNASSIGNED'])('%s gets 403', async (role) => {
      expect((await call(method, path(f()), tokens[role], body())).status).toBe(403);
    });

    test('ADMIN passes the guard', async () => {
      const res = await call(method, path(f()), tokens.ADMIN, body());
      expect(res.status).not.toBe(403);
      expect(res.status).toBeLessThan(500);
    });
  });
});
