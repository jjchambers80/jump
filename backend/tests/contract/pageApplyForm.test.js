// Spec 044D: a page's Apply button points at a standing form of its own
// organization, and the storefront sees it only once the form is published.

import request from 'supertest';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');

const TAG = 'page-apply-ct';
const emails = [`organizer@${TAG}.test`];
const auth = (token) => ['Authorization', `Bearer ${token}`];

describe('Page Apply button contract (spec 044D)', () => {
  let org;
  let otherOrg;
  let token;
  let standing;
  let eventForm;
  let foreignForm;
  let page;

  beforeAll(async () => {
    await prisma.organization.deleteMany({ where: { name: { startsWith: `${TAG} ` } } }).catch(() => {});
    token = await staffToken({ email: emails[0], role: 'ORGANIZER' });
    org = await prisma.organization.create({ data: { name: `${TAG} Store` } });
    otherOrg = await prisma.organization.create({ data: { name: `${TAG} Other` } });
    await joinOrgByToken(token, org.id, 'ORGANIZER');
    const venue = await prisma.venue.create({ data: { organizationId: org.id, name: `${TAG} Hall`, address: '1 Main', city: 'Raleigh', state: 'NC' } });
    const event = await prisma.event.create({
      data: { venueId: venue.id, name: `${TAG} Expo`, date: new Date(Date.now() + 86_400_000), status: 'PUBLISHED', capacity: 10 },
    });
    standing = await prisma.applicationForm.create({
      data: { organizationId: org.id, kind: 'FREE', name: 'Become a vendor', slug: 'become-a-vendor', status: 'DRAFT', buttonLabel: 'Apply to vend' },
    });
    eventForm = await prisma.applicationForm.create({
      data: { organizationId: org.id, eventId: event.id, kind: 'FREE', name: 'Press', slug: 'press' },
    });
    foreignForm = await prisma.applicationForm.create({
      data: { organizationId: otherOrg.id, kind: 'FREE', name: 'Elsewhere', slug: 'elsewhere' },
    });
    const created = await request(app).post('/admin/pages').set(...auth(token)).send({ title: 'Vendors', content: '<p>Sell with us</p>' });
    expect(created.status).toBe(201);
    page = created.body;
  });

  afterAll(async () => {
    await prisma.page.deleteMany({ where: { organizationId: { in: [org.id, otherOrg.id] } } }).catch(() => {});
    await prisma.applicationForm.deleteMany({ where: { organizationId: { in: [org.id, otherOrg.id] } } }).catch(() => {});
    await prisma.event.deleteMany({ where: { venue: { organizationId: org.id } } }).catch(() => {});
    await prisma.venue.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.organization.deleteMany({ where: { id: { in: [org.id, otherOrg.id] } } }).catch(() => {});
    await cleanupStaff(emails);
  });

  const attach = (body) => request(app).put(`/admin/pages/${page.id}`).set(...auth(token)).send(body);
  const publicPage = () => request(app).get(`/organizations/${org.id}/public/pages/vendors`);

  it('refuses event forms and other organizations’ forms', async () => {
    for (const formId of [eventForm.id, foreignForm.id, 'nope']) {
      const res = await attach({ applicationFormId: formId });
      expect(res.status).toBe(400);
      expect(res.body.details).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'applicationFormId' })]));
    }
  });

  it('hides a DRAFT form, shows OPEN and CLOSED with the label', async () => {
    const saved = await attach({ applicationFormId: standing.id, applyLabel: '  Join the market  ' });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ applicationFormId: standing.id, applyLabel: 'Join the market' });

    expect((await publicPage()).body.page.applyForm).toBeNull();

    await prisma.applicationForm.update({ where: { id: standing.id }, data: { status: 'OPEN' } });
    expect((await publicPage()).body.page.applyForm).toMatchObject({
      slug: 'become-a-vendor',
      name: 'Become a vendor',
      label: 'Join the market',
      status: 'OPEN',
    });

    const reopens = new Date(Date.now() + 7 * 86_400_000);
    await prisma.applicationForm.update({ where: { id: standing.id }, data: { opensAt: reopens } });
    const notYet = (await publicPage()).body.page.applyForm;
    expect(notYet).toMatchObject({ status: 'CLOSED' });
    expect(new Date(notYet.opensAt).getTime()).toBe(reopens.getTime());

    await prisma.applicationForm.update({ where: { id: standing.id }, data: { status: 'CLOSED', opensAt: null } });
    expect((await publicPage()).body.page.applyForm).toMatchObject({ status: 'CLOSED', opensAt: null });
  });

  it('removing the form clears the label', async () => {
    const res = await attach({ applicationFormId: null });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ applicationFormId: null, applyLabel: null });
    expect((await publicPage()).body.page.applyForm).toBeNull();
  });
});
