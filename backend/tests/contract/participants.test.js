// Contract tests for Participants (spec 019 phase 1)
// Organization-wide submissions list: scope (member / other org / SYSTEM_ADMIN
// / no membership), search on every field and on the id tail, sorts, the
// `event` filter, bulk across events, CSV columns, route ordering, and the
// index behind the list query. Resend mocked; Postgres is real.

import { jest } from '@jest/globals';
import request from 'supertest';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';

const sentEmails = [];
jest.unstable_mockModule('../../src/config/resend.js', () => ({
  default: { emails: { send: jest.fn(async (msg) => { sentEmails.push(msg); return { id: 'mock' }; }) } },
}));

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');
const { attachOrder, cleanupApplicationOrders } = await import('../helpers/applicationRow.js');
const { shortId } = await import('../../src/services/ApplicationService.js');

const TAG = 'participants-ct';

describe('Participants contract (spec 019 phase 1)', () => {
  let adminToken;
  let organizerToken;
  let adminBToken;
  let sysToken;
  let orphanToken;
  let org;
  let orgB;
  let expo;
  let con;
  let eventB;
  let pressForm; // FREE on expo
  let vendorForm; // PAID on expo
  let panelForm; // FREE on con
  let formB; // FREE on orgB's event
  const apps = {};
  const emails = [`admin@${TAG}.test`, `organizer@${TAG}.test`, `admin-b@${TAG}.test`, `sys@${TAG}.test`, `orphan@${TAG}.test`];
  const auth = (token) => ['Authorization', `Bearer ${token}`];
  let seq = 0;

  async function createForm(eventId, body) {
    const res = await request(app).post(`/admin/events/${eventId}/application-forms`).set(...auth(sysToken)).send(body);
    expect(res.status).toBe(201);
    return res.body;
  }

  async function submission(organizationId, eventId, form, { businessName, firstName = 'Pat', lastName, email, status = 'SUBMITTED', boothLabel = null, submittedAt } = {}) {
    seq += 1;
    const contact = await prisma.contact.create({ data: { organizationId, email: email ?? `p${seq}@${TAG}.test`, firstName, lastName: lastName ?? `Person${seq}` } });
    const profile = await prisma.applicantProfile.create({ data: { organizationId, contactId: contact.id, businessName } });
    const t = form.tiers?.[0];
    const row = await prisma.application.create({
      data: {
        formId: form.id,
        eventId,
        organizationId,
        contactId: contact.id,
        profileId: profile.id,
        tierId: t?.id ?? null,
        status,
        paymentStatus: 'NOT_REQUIRED',
        submittedAt: submittedAt ?? new Date(Date.UTC(2026, 8, 1 + seq)),
        statusTokenHash: `hash-${TAG}-${seq}`,
        boothLabel,
      },
    });
    // Spec 024: PAID-form fixtures carry their amount snapshot on an order.
    if (t) await attachOrder(row.id);
    return row;
  }

  beforeAll(async () => {
    await prisma.organization.deleteMany({ where: { name: { startsWith: `${TAG} ` } } }).catch(() => {});
    adminToken = await staffToken({ email: emails[0], role: 'ADMIN' });
    organizerToken = await staffToken({ email: emails[1], role: 'ORGANIZER' });
    adminBToken = await staffToken({ email: emails[2], role: 'ADMIN' });
    sysToken = await staffToken({ email: emails[3], role: 'SYSTEM_ADMIN' });
    orphanToken = await staffToken({ email: emails[4], role: 'ADMIN' });
    org = await prisma.organization.create({ data: { name: `${TAG} Gaming Geek`, email: `owner@${TAG}.test` } });
    orgB = await prisma.organization.create({ data: { name: `${TAG} Other Org` } });
    await joinOrgByToken(adminToken, org.id, 'ADMIN');
    await joinOrgByToken(organizerToken, org.id, 'ORGANIZER');
    await joinOrgByToken(adminBToken, orgB.id, 'ADMIN');
    const venue = await prisma.venue.create({ data: { organizationId: org.id, name: `${TAG} RCC`, address: '500 S Salisbury St', city: 'Raleigh', state: 'NC' } });
    const venueB = await prisma.venue.create({ data: { organizationId: orgB.id, name: `${TAG} Elsewhere`, address: '1 Main St', city: 'Durham', state: 'NC' } });
    expo = await prisma.event.create({ data: { venueId: venue.id, name: `${TAG} Expo 2027`, date: new Date('2027-09-18T15:00:00Z'), status: 'PUBLISHED', capacity: 1000, taxRate: 0.0725 } });
    con = await prisma.event.create({ data: { venueId: venue.id, name: `${TAG} Winter Con`, date: new Date('2027-01-10T15:00:00Z'), status: 'PUBLISHED', capacity: 500 } });
    eventB = await prisma.event.create({ data: { venueId: venueB.id, name: `${TAG} B Fest`, date: new Date('2027-05-01T15:00:00Z'), status: 'PUBLISHED', capacity: 100 } });

    pressForm = await createForm(expo.id, { kind: 'FREE', name: 'Press & Media', questions: [{ label: 'Outlet name', type: 'SHORT_TEXT', required: true }] });
    vendorForm = await createForm(expo.id, { kind: 'PAID', name: 'Vendor Space', feeMode: 'PASS', chargeTiming: 'APPROVAL', tiers: [{ name: '10x10', price: 275, quantityTotal: 5 }] });
    panelForm = await createForm(con.id, { kind: 'FREE', name: 'Panels', questions: [{ label: 'Panel title', type: 'SHORT_TEXT', required: true }] });
    formB = await createForm(eventB.id, { kind: 'FREE', name: 'Press' });

    apps.retro = await submission(org.id, expo.id, pressForm, { businessName: 'Retro Weekly', firstName: 'Pat', lastName: 'Press', email: `pat@${TAG}.test`, boothLabel: 'Media row 3' });
    apps.pixel = await submission(org.id, expo.id, vendorForm, { businessName: 'Pixel Pins', firstName: 'Val', lastName: 'Vendor', status: 'SUBMITTED' });
    apps.pia = await submission(org.id, con.id, panelForm, { businessName: 'Pia Talks', firstName: 'Pia', lastName: 'Panelist', status: 'WAITLISTED' });
    apps.approved = await submission(org.id, con.id, panelForm, { businessName: 'Approved Arcade', status: 'APPROVED' });
    apps.draft = await submission(org.id, expo.id, pressForm, { businessName: 'Draft Ghost', status: 'DRAFT' });
    apps.other = await submission(orgB.id, eventB.id, formB, { businessName: 'Other Org Outlet', boothLabel: 'Media row 9' });
  });

  afterAll(async () => {
    for (const o of [org, orgB]) {
      await prisma.application.deleteMany({ where: { organizationId: o.id } }).catch(() => {});
      await prisma.applicantProfile.deleteMany({ where: { organizationId: o.id } }).catch(() => {});
      await prisma.applicationForm.deleteMany({ where: { event: { venue: { organizationId: o.id } } } }).catch(() => {});
      await prisma.contact.deleteMany({ where: { organizationId: o.id } }).catch(() => {});
      await prisma.event.deleteMany({ where: { venue: { organizationId: o.id } } }).catch(() => {});
      await prisma.venue.deleteMany({ where: { organizationId: o.id } }).catch(() => {});
    }
    await prisma.organization.deleteMany({ where: { id: { in: [org.id, orgB.id] } } }).catch(() => {});
    await cleanupStaff(emails);
  });

  beforeEach(() => {
    sentEmails.length = 0;
  });

  const list = (token, query = '') => request(app).get(`/admin/applications${query}`).set(...auth(token));
  const names = (res) => res.body.data.map((r) => r.businessName);

  // ─── Scope ────────────────────────────────────────────────────────────────

  describe('scope', () => {
    it('a member sees every non-draft submission of their organization across events, newest first, with event and shortId', async () => {
      const res = await list(organizerToken);
      expect(res.status).toBe(200);
      expect(names(res)).toEqual(['Approved Arcade', 'Pia Talks', 'Pixel Pins', 'Retro Weekly']);
      expect(res.body.total).toBe(4);
      expect(res.body.summary).toEqual({ SUBMITTED: 2, WAITLISTED: 1, APPROVED: 1 });
      const retro = res.body.data.find((r) => r.id === apps.retro.id);
      expect(retro).toMatchObject({
        eventId: expo.id,
        event: { id: expo.id, name: expo.name },
        shortId: shortId(apps.retro.id),
        formName: 'Press & Media',
        formKind: 'FREE',
        boothLabel: 'Media row 3',
        logoUrl: null,
      });
      expect(retro.statusUrl).toContain(`/events/${expo.id}/apply/status/${apps.retro.id}?token=`);
      expect(retro.organization).toBeUndefined();
    });

    it('the other organization sees only its own rows', async () => {
      const res = await list(adminBToken);
      expect(res.status).toBe(200);
      expect(names(res)).toEqual(['Other Org Outlet']);
    });

    it('SYSTEM_ADMIN sees every organization, each row carrying its organization', async () => {
      const res = await list(sysToken, `?q=${TAG}`);
      expect(res.status).toBe(200);
      const all = await list(sysToken);
      const ours = all.body.data.filter((r) => [org.id, orgB.id].includes(r.organization?.id));
      expect(ours.map((r) => r.businessName).sort()).toEqual(['Approved Arcade', 'Other Org Outlet', 'Pia Talks', 'Pixel Pins', 'Retro Weekly']);
      expect(ours.find((r) => r.businessName === 'Other Org Outlet').organization).toEqual({ id: orgB.id, name: orgB.name });
    });

    it('a staff user with no membership gets an empty list, summary and forms', async () => {
      const res = await list(orphanToken);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: [], total: 0, page: 1, pageSize: 0, summary: {} });
      expect((await request(app).get('/admin/applications/summary').set(...auth(orphanToken))).body).toEqual({});
      expect((await request(app).get('/admin/application-forms').set(...auth(orphanToken))).body).toEqual({ data: [] });
    });

    it('route ordering: /admin/applications/summary is the org summary, not an event id', async () => {
      const res = await request(app).get('/admin/applications/summary').set(...auth(organizerToken));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ SUBMITTED: 2, WAITLISTED: 1, APPROVED: 1 });
    });

    it('a buyer / unauthenticated caller is refused', async () => {
      expect((await request(app).get('/admin/applications')).status).toBe(401);
    });
  });

  // ─── Search, filters, sort ────────────────────────────────────────────────

  describe('search and filters', () => {
    it.each([
      ['business name', 'retro', ['Retro Weekly']],
      ['contact first name', 'pia', ['Pia Talks']],
      ['contact last name', 'vendor', ['Pixel Pins']],
      ['email', `pat@${TAG}`, ['Retro Weekly']],
      ['form name', 'panels', ['Approved Arcade', 'Pia Talks']],
      ['booth label', 'media row', ['Retro Weekly']],
    ])('q matches on %s', async (_label, q, expected) => {
      const res = await list(organizerToken, `?q=${encodeURIComponent(q)}`);
      expect(res.status).toBe(200);
      expect(names(res)).toEqual(expected);
    });

    it('q matches the id tail shown as shortId, case-insensitively, and the full id', async () => {
      const tail = shortId(apps.pixel.id);
      expect(names(await list(organizerToken, `?q=${tail}`))).toEqual(['Pixel Pins']);
      expect(names(await list(organizerToken, `?q=${tail.toLowerCase()}`))).toEqual(['Pixel Pins']);
      expect(names(await list(organizerToken, `?q=${apps.pixel.id}`))).toEqual(['Pixel Pins']);
    });

    it('q never crosses organizations', async () => {
      expect(names(await list(organizerToken, '?q=other+org'))).toEqual([]);
      expect(names(await list(organizerToken, `?q=${shortId(apps.other.id)}`))).toEqual([]);
    });

    it('event filter narrows to one event in scope; outside the scope it is a 404', async () => {
      const res = await list(organizerToken, `?event=${con.id}`);
      expect(names(res)).toEqual(['Approved Arcade', 'Pia Talks']);
      // Summary stays organization-wide while a filter is applied (chips stay stable).
      expect(res.body.summary).toEqual({ SUBMITTED: 2, WAITLISTED: 1, APPROVED: 1 });
      expect((await list(organizerToken, `?event=${eventB.id}`)).status).toBe(404);
      expect((await list(sysToken, `?event=${eventB.id}`)).status).toBe(200);
    });

    it('form, status and payment filters compose', async () => {
      expect(names(await list(organizerToken, `?form=${panelForm.id}&status=WAITLISTED`))).toEqual(['Pia Talks']);
      expect(names(await list(organizerToken, '?status=SUBMITTED,APPROVED'))).toEqual(['Approved Arcade', 'Pixel Pins', 'Retro Weekly']);
      expect(names(await list(organizerToken, '?payment=PAID'))).toEqual([]);
    });

    it.each([
      ['', ['Approved Arcade', 'Pia Talks', 'Pixel Pins', 'Retro Weekly']],
      ['submitted_asc', ['Retro Weekly', 'Pixel Pins', 'Pia Talks', 'Approved Arcade']],
      ['business', ['Approved Arcade', 'Pia Talks', 'Pixel Pins', 'Retro Weekly']],
      ['business_desc', ['Retro Weekly', 'Pixel Pins', 'Pia Talks', 'Approved Arcade']],
      // Postgres orders enums by declaration: SUBMITTED < WAITLISTED < APPROVED.
      ['status', ['Pixel Pins', 'Retro Weekly', 'Pia Talks', 'Approved Arcade']],
      ['status_desc', ['Approved Arcade', 'Pia Talks', 'Pixel Pins', 'Retro Weekly']],
      ['event', ['Pixel Pins', 'Retro Weekly', 'Approved Arcade', 'Pia Talks']],
    ])('sort=%s', async (sort, expected) => {
      const res = await list(organizerToken, sort ? `?sort=${sort}` : '');
      expect(res.status).toBe(200);
      expect(names(res)).toEqual(expected);
    });

    it('pages with the requested size', async () => {
      const res = await list(organizerToken, '?pageSize=2&page=2');
      expect(res.body).toMatchObject({ page: 2, pageSize: 2, total: 4 });
      expect(names(res)).toEqual(['Pixel Pins', 'Retro Weekly']);
    });

    it('the list query can use the (organizationId, submittedAt) index', async () => {
      // The test table is tiny, so the planner prefers a seq scan (or the
      // narrower organizationId index plus a sort); disable both for this
      // transaction to prove the ordered index exists and fits the query.
      const [, , plan] = await prisma.$transaction([
        prisma.$executeRawUnsafe('SET LOCAL enable_seqscan = off'),
        prisma.$executeRawUnsafe('SET LOCAL enable_sort = off'),
        prisma.$queryRawUnsafe(`EXPLAIN SELECT id FROM "Application" WHERE "organizationId" = $1 AND status <> 'DRAFT' ORDER BY "submittedAt" DESC LIMIT 25`, org.id),
      ]);
      const text = plan.map((r) => r['QUERY PLAN']).join('\n');
      expect(text).toMatch(/Index Scan Backward using "?Application_organizationId_submittedAt_idx/);
    });
  });

  // ─── Forms across events ──────────────────────────────────────────────────

  describe('GET /admin/application-forms', () => {
    it('lists forms across the organization with their event, newest event first', async () => {
      const res = await request(app).get('/admin/application-forms').set(...auth(organizerToken));
      expect(res.status).toBe(200);
      expect(res.body.data.map((f) => [f.event.name, f.name])).toEqual([
        [expo.name, 'Press & Media'],
        [expo.name, 'Vendor Space'],
        [con.name, 'Panels'],
      ]);
      const press = res.body.data[0];
      expect(press).toMatchObject({ id: pressForm.id, eventId: expo.id, kind: 'FREE', status: 'DRAFT', applicationCount: 1, addOns: [] });
      expect(press.organization).toBeUndefined();
      expect(res.body.data.some((f) => f.id === formB.id)).toBe(false);
    });

    it('SYSTEM_ADMIN sees forms of every organization, tagged with the organization', async () => {
      const res = await request(app).get('/admin/application-forms').set(...auth(sysToken));
      const b = res.body.data.find((f) => f.id === formB.id);
      expect(b.organization).toEqual({ id: orgB.id, name: orgB.name });
    });
  });

  // ─── Bulk across events ───────────────────────────────────────────────────

  describe('POST /admin/applications/bulk', () => {
    it('decides across two events in one call, refuses a PAID approve, reports ids outside the scope as not found', async () => {
      const res = await request(app)
        .post('/admin/applications/bulk')
        .set(...auth(organizerToken))
        .send({ ids: [apps.retro.id, apps.pia.id, apps.pixel.id, apps.other.id, 'nope'], decision: 'APPROVE' });
      expect(res.status).toBe(200);
      expect(res.body.results).toEqual([
        { id: apps.retro.id, ok: true },
        { id: apps.pia.id, ok: true },
        { id: apps.pixel.id, ok: false, error: 'Approve paid applications one at a time' },
        { id: apps.other.id, ok: false, error: 'Application not found' },
        { id: 'nope', ok: false, error: 'Application not found' },
      ]);
      expect(res.body).toMatchObject({ succeeded: 2, failed: 3 });
      const after = await prisma.application.findMany({ where: { id: { in: [apps.retro.id, apps.pia.id, apps.other.id] } }, select: { id: true, status: true } });
      expect(Object.fromEntries(after.map((a) => [a.id, a.status]))).toEqual({ [apps.retro.id]: 'APPROVED', [apps.pia.id]: 'APPROVED', [apps.other.id]: 'SUBMITTED' });
      expect(sentEmails.length).toBe(2);
    });

    it('validates the body', async () => {
      const res = await request(app).post('/admin/applications/bulk').set(...auth(organizerToken)).send({ ids: [], decision: 'APPROVE' });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/1-200/);
    });

    it('a staff user with no membership decides nothing', async () => {
      const res = await request(app).post('/admin/applications/bulk').set(...auth(orphanToken)).send({ ids: [apps.approved.id], decision: 'WITHDRAW' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ results: [{ id: apps.approved.id, ok: false, error: 'Application not found' }], succeeded: 0, failed: 1 });
    });
  });

  // ─── CSV ──────────────────────────────────────────────────────────────────

  describe('GET /admin/applications/export.csv', () => {
    it('prepends event columns for a member and organization for SYSTEM_ADMIN; filters apply', async () => {
      const res = await request(app).get('/admin/applications/export.csv?status=WAITLISTED,SUBMITTED').set(...auth(organizerToken));
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/csv/);
      expect(res.headers['content-disposition']).toMatch(/participants-\d{4}-\d{2}-\d{2}\.csv/);
      const lines = res.text.split('\r\n');
      expect(lines[0].startsWith('event,eventDate,applicationId,form,status,')).toBe(true);
      expect(lines).toHaveLength(2); // header + Pixel Pins (retro and pia were approved above)
      expect(lines[1].startsWith(`${expo.name},2027-09-18T15:00:00.000Z,${apps.pixel.id},Vendor Space,SUBMITTED,`)).toBe(true);

      const sys = await request(app).get(`/admin/applications/export.csv?q=${shortId(apps.other.id)}`).set(...auth(sysToken));
      const sysLines = sys.text.split('\r\n');
      expect(sysLines[0].startsWith('organization,event,eventDate,applicationId,')).toBe(true);
      expect(sysLines[1].startsWith(`${orgB.name},${eventB.name},`)).toBe(true);
    });

    it('a member with no organization exports an empty file', async () => {
      const res = await request(app).get('/admin/applications/export.csv').set(...auth(orphanToken));
      expect(res.status).toBe(200);
      expect(res.text).toBe('');
    });
  });

  // ─── Per-event routes unchanged ───────────────────────────────────────────

  it('the per-event list still scopes to its event and carries the new row fields', async () => {
    const res = await request(app).get(`/admin/events/${con.id}/applications`).set(...auth(adminToken));
    expect(res.status).toBe(200);
    expect(names(res).sort()).toEqual(['Approved Arcade', 'Pia Talks']);
    expect(res.body.data[0]).toMatchObject({ eventId: con.id, event: { id: con.id }, shortId: expect.any(String) });
    expect(res.body.data[0].statusUrl).toContain('/apply/status/');
  });
});
