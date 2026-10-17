// Contract tests for the special guest lineup (spec 050 §6.3 / §7.6, card
// 050-Q): CRUD, link rules, reorder, image upload, the org guard, add-to-lineup
// (409, profile copy and the no-profile fallback), the public payload hiding
// invisible rows, the preview payload carrying every row, and duplicate not
// copying the lineup.

import request from 'supertest';
import sharp from 'sharp';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');

const TAG = `guests-${process.pid}-${Date.now()}`;
const emails = [`organizer@${TAG}.test`, `outsider@${TAG}.test`, `unassigned@${TAG}.test`];

describe('Special guest lineup (spec 050 §7.6)', () => {
  const tokens = {};
  let org;
  let otherOrg;
  let eventId;
  let guestForm;
  let vendorForm;
  let seq = 0;

  const call = (method, path, token = tokens.ORGANIZER, body) => {
    const req = request(app)[method](path).set('Authorization', `Bearer ${token}`).set('X-Jump-Org', org.id);
    return body === undefined ? req : req.send(body);
  };
  const base = () => `/organizations/${org.id}/events/${eventId}/guests`;

  const application = async ({ form = guestForm, status = 'APPROVED', profile } = {}) => {
    const contact = await prisma.contact.create({ data: { organizationId: org.id, email: `a${seq++}@${TAG}.test`, firstName: 'Mara', lastName: 'Voss' } });
    let profileId = null;
    if (profile) {
      const file = await prisma.file.create({ data: { hash: `${TAG}-${seq++}`, mimeType: 'image/png', sizeBytes: 1 } });
      const image = await prisma.image.create({ data: { fileId: file.id, usageType: 'applicant_profile' } });
      const row = await prisma.applicantProfile.create({
        data: { organizationId: org.id, contactId: contact.id, ...profile, images: { create: [{ imageId: image.id, displayOrder: 0 }] } },
      });
      profileId = row.id;
    }
    return prisma.application.create({
      data: { formId: form.id, eventId, organizationId: org.id, contactId: contact.id, profileId, status, submittedAt: new Date(), statusTokenHash: `${TAG}-st-${seq++}` },
    });
  };
  const addToLineup = (applicationId) => call('post', `/admin/events/${eventId}/applications/${applicationId}/add-to-lineup`);

  beforeAll(async () => {
    tokens.ORGANIZER = await staffToken({ email: emails[0], role: 'ORGANIZER' });
    tokens.OUTSIDER = await staffToken({ email: emails[1], role: 'ORGANIZER' });
    tokens.UNASSIGNED = await staffToken({ email: emails[2], role: 'UNASSIGNED' });
    org = await prisma.organization.create({ data: { name: `${TAG} Org` } });
    otherOrg = await prisma.organization.create({ data: { name: `${TAG} Other` } });
    await joinOrgByToken(tokens.ORGANIZER, org.id, 'ORGANIZER');
    await joinOrgByToken(tokens.OUTSIDER, otherOrg.id, 'ORGANIZER');
    const venue = await prisma.venue.create({ data: { organizationId: org.id, name: `${TAG} Hall`, address: '1 Main St', city: 'Raleigh', state: 'NC', timezone: 'America/New_York' } });
    eventId = (await prisma.event.create({ data: { venueId: venue.id, name: `${TAG} Con`, date: new Date('2027-09-18T15:00:00Z'), status: 'PUBLISHED', capacity: 100 } })).id;
    guestForm = await prisma.applicationForm.create({ data: { organizationId: org.id, eventId, name: 'Guests', slug: `guests-${seq++}`, kind: 'FREE' } });
    vendorForm = await prisma.applicationForm.create({ data: { organizationId: org.id, eventId, name: 'Vendors', slug: `vendors-${seq++}`, kind: 'FREE' } });
  });

  afterAll(async () => {
    await prisma.eventGuest.deleteMany({ where: { event: { venue: { organizationId: org.id } } } }).catch(() => {});
    await prisma.application.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.applicantProfile.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.applicationForm.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.contact.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.event.deleteMany({ where: { venue: { organizationId: org.id } } }).catch(() => {});
    await prisma.venue.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.organization.deleteMany({ where: { id: { in: [org.id, otherOrg.id] } } }).catch(() => {});
    await cleanupStaff(emails);
  });

  it('ORGANIZER creates, lists, updates and deletes guests by hand', async () => {
    const a = await call('post', base(), undefined, { name: '  Jo Park ', role: 'Voice actor', bio: 'Line one\n<b>not html</b>', links: { instagram: 'https://instagram.com/jo', website: 'https://jo.example' } });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ name: 'Jo Park', role: 'Voice actor', bio: 'Line one\n<b>not html</b>', isVisible: true, displayOrder: 0, imageUrl: null, applicationId: null });
    expect(a.body.links).toEqual({ instagram: 'https://instagram.com/jo', website: 'https://jo.example' });
    const b = await call('post', base(), undefined, { name: 'Temp' });
    expect(b.body.displayOrder).toBe(1);

    const patched = await call('patch', `${base()}/${b.body.id}`, undefined, { name: 'Sam Lee', role: null, isVisible: false });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ name: 'Sam Lee', role: null, isVisible: false });

    const list = await call('get', base());
    expect(list.status).toBe(200);
    expect(list.body.data.map((g) => g.name)).toEqual(['Jo Park', 'Sam Lee']);

    const c = await call('post', base(), undefined, { name: 'Gone' });
    expect((await call('delete', `${base()}/${c.body.id}`)).status).toBe(204);
    expect((await call('get', base())).body.data).toHaveLength(2);
  });

  it('validates name, lengths and link hosts', async () => {
    for (const body of [{}, { name: '   ' }, { name: 'x'.repeat(121) }, { name: 'x', role: 'r'.repeat(81) }, { name: 'x', bio: 'b'.repeat(601) }, { name: 'x', links: { instagram: 'https://evil.example/jo' } }, { name: 'x', links: { myspace: 'https://myspace.com/jo' } }, { name: 'x', links: { website: 'http://insecure.example' } }, { name: 'x', isVisible: 'yes' }]) {
      const res = await call('post', base(), undefined, body);
      expect([res.status, JSON.stringify(body)]).toEqual([400, JSON.stringify(body)]);
    }
  });

  it('reorders with every id exactly once', async () => {
    const ids = (await call('get', base())).body.data.map((g) => g.id);
    const res = await call('post', `${base()}/reorder`, undefined, { ids: [...ids].reverse() });
    expect(res.status).toBe(200);
    expect(res.body.data.map((g) => g.id)).toEqual([...ids].reverse());
    expect((await call('post', `${base()}/reorder`, undefined, { ids: [ids[0]] })).status).toBe(400);
    expect((await call('post', `${base()}/reorder`, undefined, { ids: [ids[0], ids[0]] })).status).toBe(400);
    await call('post', `${base()}/reorder`, undefined, { ids });
  });

  it('uploads and removes a square guest image', async () => {
    const guest = (await call('get', base())).body.data[0];
    const png = await sharp({ create: { width: 300, height: 200, channels: 3, background: { r: Date.now() % 200, g: 40, b: 90 } } }).png().toBuffer();
    const up = await request(app).post(`${base()}/${guest.id}/image`).set('Authorization', `Bearer ${tokens.ORGANIZER}`).set('X-Jump-Org', org.id).attach('logo', png, { filename: 'jo.png', contentType: 'image/png' });
    expect(up.status).toBe(200);
    expect(up.body.imageUrl).toMatch(/\/square$/);
    const del = await call('delete', `${base()}/${guest.id}/image`);
    expect(del.status).toBe(200);
    expect(del.body.imageUrl).toBeNull();
  });

  it("refuses another organization's organizer and UNASSIGNED", async () => {
    const guest = (await call('get', base())).body.data[0];
    const outsider = (method, path, body) => request(app)[method](path).set('Authorization', `Bearer ${tokens.OUTSIDER}`).send(body);
    for (const [method, path, body] of [['get', base()], ['post', base(), { name: 'x' }], ['patch', `${base()}/${guest.id}`, { name: 'x' }], ['delete', `${base()}/${guest.id}`], ['post', `${base()}/reorder`, { ids: [guest.id] }]]) {
      expect([403, 404]).toContain((await outsider(method, path, body)).status);
    }
    // Their own org id in the path, our event: not found.
    const own = await request(app).get(`/organizations/${otherOrg.id}/events/${eventId}/guests`).set('Authorization', `Bearer ${tokens.OUTSIDER}`);
    expect(own.status).toBe(404);
    expect([403, 404]).toContain((await call('get', base(), tokens.UNASSIGNED)).status);
    const app1 = await application();
    expect([403, 404]).toContain((await request(app).post(`/admin/events/${eventId}/applications/${app1.id}/add-to-lineup`).set('Authorization', `Bearer ${tokens.OUTSIDER}`)).status);
    expect(await prisma.eventGuest.count({ where: { applicationId: app1.id } })).toBe(0);

    const png = await sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer();
    const upload = await request(app).post(`${base()}/${guest.id}/image`).set('Authorization', `Bearer ${tokens.OUTSIDER}`).attach('logo', png, { filename: 'x.png', contentType: 'image/png' });
    expect([403, 404]).toContain(upload.status);
    expect([403, 404]).toContain((await outsider('delete', `${base()}/${guest.id}/image`)).status);
  });

  it('refuses a reorder that names a guest of another event in the same organization', async () => {
    const venueId = (await prisma.event.findUnique({ where: { id: eventId }, select: { venueId: true } })).venueId;
    const other = await prisma.event.create({ data: { venueId, name: `${TAG} Other`, date: new Date('2027-10-18T15:00:00Z'), status: 'DRAFT', capacity: 10 } });
    const foreign = await prisma.eventGuest.create({ data: { eventId: other.id, name: 'Elsewhere' } });
    const ids = (await call('get', base())).body.data.map((g) => g.id);
    const res = await call('post', `${base()}/reorder`, undefined, { ids: [...ids.slice(1), foreign.id] });
    expect(res.status).toBe(400);
    expect((await prisma.eventGuest.findUnique({ where: { id: foreign.id } })).eventId).toBe(other.id);
  });

  describe('add to lineup', () => {
    it('copies the profile: name, bio, first photo, allowed links; 409 the second time', async () => {
      const a = await application({ profile: { businessName: 'Mara Voss Studio', description: 'Cosplayer and prop maker.', website: 'https://mara.example', socials: { instagram: 'https://instagram.com/mara', tiktok: 'https://evil.example/x', other: 'https://other.example' } } });
      const res = await addToLineup(a.id);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ name: 'Mara Voss Studio', bio: 'Cosplayer and prop maker.', applicationId: a.id, isVisible: true });
      expect(res.body.links).toEqual({ instagram: 'https://instagram.com/mara', website: 'https://mara.example' });
      expect(res.body.imageUrl).toMatch(/\/square$/);
      const again = await addToLineup(a.id);
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('ALREADY_IN_LINEUP');
      const detail = await call('get', `/admin/events/${eventId}/applications/${a.id}`);
      expect(detail.body.lineupGuestId).toBe(res.body.id);
    });

    it('a concurrent double click creates one row and answers 409 to the other', async () => {
      const a = await application();
      const results = await Promise.all([addToLineup(a.id), addToLineup(a.id)]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(results.find((r) => r.status === 409).body.code).toBe('ALREADY_IN_LINEUP');
      expect(await prisma.eventGuest.count({ where: { applicationId: a.id } })).toBe(1);
    });

    it('hides the lineup row when the application leaves APPROVED (withdrawn); the organizer can show it again', async () => {
      const a = await application();
      const guest = (await addToLineup(a.id)).body;
      const res = await call('post', `/admin/events/${eventId}/applications/${a.id}/decision`, undefined, { decision: 'WITHDRAW', sendEmail: false });
      expect(res.status).toBe(200);
      expect((await prisma.eventGuest.findUnique({ where: { id: guest.id } })).isVisible).toBe(false);
      const shown = await call('patch', `${base()}/${guest.id}`, undefined, { isVisible: true });
      expect(shown.body.isVisible).toBe(true);
    });

    it('falls back to the applicant name when the form collected no profile', async () => {
      const a = await application();
      const res = await addToLineup(a.id);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ name: 'Mara Voss', bio: null, imageUrl: null, links: null });
    });

    it('refuses unapproved applications; any approved form joins (forms have no type)', async () => {
      const pending = await application({ status: 'SUBMITTED' });
      expect((await addToLineup(pending.id)).status).toBe(409);
      const vendor = await application({ form: vendorForm });
      const res = await addToLineup(vendor.id);
      expect(res.status).toBe(201);
      expect(res.body.eventId).toBe(eventId);
    });
  });

  it('the public payload carries only visible rows, in order; the preview payload carries every row', async () => {
    const all = (await call('get', base())).body.data;
    const hidden = all.find((g) => !g.isVisible);
    expect(hidden).toBeDefined();
    const pub = await request(app).get(`/events/${eventId}`);
    expect(pub.status).toBe(200);
    expect(pub.body.guests.map((g) => g.id)).toEqual(all.filter((g) => g.isVisible).map((g) => g.id));
    expect(pub.body.guests.find((g) => g.id === hidden.id)).toBeUndefined();
    expect(Object.keys(pub.body.guests[0]).sort()).toEqual(['bio', 'id', 'imageUrl', 'links', 'name', 'role']);

    const preview = await call('get', `/organizations/${org.id}/events/${eventId}/preview-payload`);
    expect(preview.status).toBe(200);
    expect(preview.body.guests.map((g) => g.id)).toEqual(all.map((g) => g.id));
    expect(preview.body.guests.find((g) => g.id === hidden.id).isVisible).toBe(false);
    expect(preview.body.event.guests.find((g) => g.id === hidden.id)).toBeUndefined();
  });

  it('duplicating the event does not copy the lineup', async () => {
    const res = await call('post', `/organizations/${org.id}/events/${eventId}/duplicate`, undefined, { name: `${TAG} Con 2`, date: '2028-09-18T15:00:00.000Z' });
    expect([200, 201]).toContain(res.status);
    expect(await prisma.eventGuest.count({ where: { eventId: res.body.id } })).toBe(0);
  });
});
