// Contract tests for Participants tags and check-in (spec 019 phase 3)
// Tag normalisation and limits, the `tag` filter, `q` on a tag, distinct
// tags per scope, check-in on APPROVED only, clearing, CSV columns.

import request from 'supertest';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');

const TAG = 'tags-ct';

describe('Participants tags and check-in (spec 019 phase 3)', () => {
  let organizerToken;
  let adminBToken;
  let sysToken;
  let org;
  let orgB;
  let expo;
  let con;
  let form;
  let formC;
  const apps = {};
  const emails = [`organizer@${TAG}.test`, `admin-b@${TAG}.test`, `sys@${TAG}.test`];
  const auth = (token) => ['Authorization', `Bearer ${token}`];
  let seq = 0;

  async function submission(organizationId, eventId, formId, { businessName, status = 'SUBMITTED', tags = [] }) {
    seq += 1;
    const contact = await prisma.contact.create({ data: { organizationId, email: `p${seq}@${TAG}.test`, firstName: 'Pat', lastName: `Person${seq}` } });
    const profile = await prisma.applicantProfile.create({ data: { organizationId, contactId: contact.id, businessName } });
    return prisma.application.create({
      data: { formId, eventId, organizationId, contactId: contact.id, profileId: profile.id, status, paymentStatus: 'NOT_REQUIRED', submittedAt: new Date(Date.UTC(2026, 8, 1 + seq)), statusTokenHash: `hash-${TAG}-${seq}`, tags },
    });
  }

  beforeAll(async () => {
    await prisma.organization.deleteMany({ where: { name: { startsWith: `${TAG} ` } } }).catch(() => {});
    organizerToken = await staffToken({ email: emails[0], role: 'ORGANIZER' });
    adminBToken = await staffToken({ email: emails[1], role: 'ADMIN' });
    sysToken = await staffToken({ email: emails[2], role: 'SYSTEM_ADMIN' });
    org = await prisma.organization.create({ data: { name: `${TAG} Gaming Geek`, email: `owner@${TAG}.test` } });
    orgB = await prisma.organization.create({ data: { name: `${TAG} Other Org` } });
    await joinOrgByToken(organizerToken, org.id, 'ORGANIZER');
    await joinOrgByToken(adminBToken, orgB.id, 'ADMIN');
    const venue = await prisma.venue.create({ data: { organizationId: org.id, name: `${TAG} RCC`, address: '500 S Salisbury St', city: 'Raleigh', state: 'NC' } });
    const venueB = await prisma.venue.create({ data: { organizationId: orgB.id, name: `${TAG} Elsewhere`, address: '1 Main St', city: 'Durham', state: 'NC' } });
    expo = await prisma.event.create({ data: { venueId: venue.id, name: `${TAG} Expo`, date: new Date('2027-09-18T15:00:00Z'), status: 'PUBLISHED', capacity: 100 } });
    con = await prisma.event.create({ data: { venueId: venue.id, name: `${TAG} Con`, date: new Date('2027-01-10T15:00:00Z'), status: 'PUBLISHED', capacity: 100 } });
    const eventB = await prisma.event.create({ data: { venueId: venueB.id, name: `${TAG} B Fest`, date: new Date('2027-05-01T15:00:00Z'), status: 'PUBLISHED', capacity: 100 } });
    form = await prisma.applicationForm.create({ data: { eventId: expo.id, kind: 'FREE', name: 'Press', slug: 'press' } });
    formC = await prisma.applicationForm.create({ data: { eventId: con.id, kind: 'FREE', name: 'Panels', slug: 'panels' } });
    const formB = await prisma.applicationForm.create({ data: { eventId: eventB.id, kind: 'FREE', name: 'Press', slug: 'press' } });

    apps.retro = await submission(org.id, expo.id, form.id, { businessName: 'Retro Weekly', status: 'APPROVED', tags: ['Media row 3', 'Press'] });
    apps.pixel = await submission(org.id, expo.id, form.id, { businessName: 'Pixel Pins', tags: ['Sponsor', 'Returning'] });
    apps.pia = await submission(org.id, con.id, formC.id, { businessName: 'Pia Talks', status: 'APPROVED', tags: ['returning'] });
    apps.other = await submission(orgB.id, eventB.id, formB.id, { businessName: 'Other Org Outlet', tags: ['Sponsor', 'B only'] });
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

  const patch = (token, eventId, id, body) => request(app).patch(`/admin/events/${eventId}/applications/${id}`).set(...auth(token)).send(body);
  const names = (res) => res.body.data.map((r) => r.businessName);

  describe('tags', () => {
    it('trims, collapses whitespace, dedupes case-insensitively keeping the first spelling, drops blanks; list rows carry tags', async () => {
      const res = await patch(organizerToken, expo.id, apps.retro.id, { tags: ['  Media  row 3 ', 'media row 3', 'MEDIA ROW 3', '', 'Press', 'press '] });
      expect(res.status).toBe(200);
      expect(res.body.tags).toEqual(['Media row 3', 'Press']);
      const list = await request(app).get(`/admin/applications?q=retro`).set(...auth(organizerToken));
      expect(list.body.data[0]).toMatchObject({ tags: ['Media row 3', 'Press'], checkedInAt: null, checkedOutAt: null });
    });

    it.each([
      ['not an array', { tags: 'Sponsor' }, /tags must be an array/],
      ['a non-string', { tags: [1] }, /tags must be an array of strings/],
      ['a tag over 40 characters', { tags: ['x'.repeat(41)] }, /40 characters or fewer/],
      ['more than 20 tags', { tags: Array.from({ length: 21 }, (_, i) => `t${i}`) }, /at most 20 tags/],
      ['an unknown field', { colour: 'red' }, /Unknown/],
      ['an empty body', {}, /Nothing to update/],
    ])('rejects %s', async (_label, body, message) => {
      const res = await patch(organizerToken, expo.id, apps.retro.id, body);
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(message);
    });

    it('boothLabel and internalNote still save through the same PATCH (phase 1 shape)', async () => {
      const res = await patch(organizerToken, expo.id, apps.retro.id, { boothLabel: '104', internalNote: 'VIP' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ boothLabel: '104', internalNote: 'VIP', tags: ['Media row 3', 'Press'] });
    });

    it('tag filter is exact; q matches a tag exactly and boothLabel loosely; neither crosses organizations', async () => {
      expect(names(await request(app).get('/admin/applications?tag=Returning').set(...auth(organizerToken)))).toEqual(['Pixel Pins']);
      expect(names(await request(app).get('/admin/applications?tag=returning').set(...auth(organizerToken)))).toEqual(['Pia Talks']);
      expect(names(await request(app).get('/admin/applications?tag=Sponsor').set(...auth(organizerToken)))).toEqual(['Pixel Pins']);
      expect(names(await request(app).get('/admin/applications?q=Sponsor').set(...auth(organizerToken)))).toEqual(['Pixel Pins']);
      expect(names(await request(app).get('/admin/applications?q=Press').set(...auth(organizerToken)))).toEqual(['Pixel Pins', 'Retro Weekly']);
      expect(names(await request(app).get(`/admin/events/${expo.id}/applications?tag=Sponsor`).set(...auth(organizerToken)))).toEqual(['Pixel Pins']);
    });

    it('distinct tags: organization-wide, per event, other organization, SYSTEM_ADMIN across all, no membership empty', async () => {
      const mine = await request(app).get('/admin/applications/tags').set(...auth(organizerToken));
      expect(mine.status).toBe(200);
      // One spelling per tag (case-insensitive), alphabetical.
      expect(mine.body.data.map((t) => t.toLowerCase())).toEqual(['media row 3', 'press', 'returning', 'sponsor']);
      expect((await request(app).get(`/admin/events/${con.id}/applications/tags`).set(...auth(organizerToken))).body.data).toEqual(['returning']);
      expect((await request(app).get('/admin/applications/tags').set(...auth(adminBToken))).body.data).toEqual(['B only', 'Sponsor']);
      const all = (await request(app).get('/admin/applications/tags').set(...auth(sysToken))).body.data;
      expect(all.map((t) => t.toLowerCase())).toEqual(expect.arrayContaining(['b only', 'media row 3', 'returning', 'sponsor']));
      const orphan = await staffToken({ email: `orphan@${TAG}.test`, role: 'ORGANIZER' });
      expect((await request(app).get('/admin/applications/tags').set(...auth(orphan))).body).toEqual({ data: [] });
      await cleanupStaff([`orphan@${TAG}.test`]);
      // Per-event tags outside the org are a 404 like the event itself.
      expect((await request(app).get(`/admin/events/${expo.id}/applications/tags`).set(...auth(adminBToken))).status).toBe(404);
    });
  });

  describe('check-in', () => {
    it('stamps checkedInAt / checkedOutAt on an APPROVED application, keeps an existing stamp on repeat, clears on false', async () => {
      const inRes = await patch(organizerToken, expo.id, apps.retro.id, { checkedIn: true });
      expect(inRes.status).toBe(200);
      expect(inRes.body.checkedInAt).toEqual(expect.any(String));
      expect(inRes.body.checkedOutAt).toBeNull();
      const first = inRes.body.checkedInAt;

      const again = await patch(organizerToken, expo.id, apps.retro.id, { checkedIn: true, checkedOut: true });
      expect(again.body.checkedInAt).toBe(first);
      expect(again.body.checkedOutAt).toEqual(expect.any(String));

      const cleared = await patch(organizerToken, expo.id, apps.retro.id, { checkedOut: false });
      expect(cleared.body.checkedInAt).toBe(first);
      expect(cleared.body.checkedOutAt).toBeNull();

      const row = (await request(app).get(`/admin/applications?q=retro`).set(...auth(organizerToken))).body.data[0];
      expect(row.checkedInAt).toBe(first);
    });

    it('is refused on a non-approved application and validates the booleans', async () => {
      const res = await patch(organizerToken, expo.id, apps.pixel.id, { checkedIn: true });
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/Only approved applications/);
      const bad = await patch(organizerToken, expo.id, apps.retro.id, { checkedIn: 'yes' });
      expect(bad.status).toBe(400);
      expect(bad.body.message).toMatch(/checkedIn must be a boolean/);
      // Other organization: not found.
      expect((await patch(adminBToken, expo.id, apps.retro.id, { checkedIn: true })).status).toBe(404);
    });
  });

  it('CSV carries tags and check-in columns', async () => {
    const res = await request(app).get('/admin/applications/export.csv?q=retro').set(...auth(organizerToken));
    const [header, row] = res.text.split('\r\n');
    const cols = header.split(',');
    const cells = row.split(',');
    expect(cells[cols.indexOf('tags')]).toBe('Media row 3; Press');
    expect(cells[cols.indexOf('checkedInAt')]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(cells[cols.indexOf('checkedOutAt')]).toBe('');
    expect(cells[cols.indexOf('boothLabel')]).toBe('104');
  });
});
