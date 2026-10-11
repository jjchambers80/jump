// Contract tests for Settings › Policies (spec 052).

import request from 'supertest';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');

const TAG = 'policies-ct';
const emails = [`admin@${TAG}.test`, `organizer@${TAG}.test`, `other@${TAG}.test`];
const auth = (token) => ['Authorization', `Bearer ${token}`];
const PATH = '/admin/settings/policies';

describe('Store policies contract', () => {
  let organization;
  let otherOrganization;
  let adminToken;
  let organizerToken;
  let otherToken;

  beforeAll(async () => {
    await prisma.organization.deleteMany({ where: { name: { startsWith: `${TAG} ` } } }).catch(() => {});
    adminToken = await staffToken({ email: emails[0], role: 'ADMIN' });
    organizerToken = await staffToken({ email: emails[1], role: 'ORGANIZER' });
    otherToken = await staffToken({ email: emails[2], role: 'ADMIN' });
    organization = await prisma.organization.create({
      data: { name: `${TAG} Store`, companyName: `${TAG} <b>LLC</b>`, email: 'hello@policies-ct.test' },
    });
    otherOrganization = await prisma.organization.create({ data: { name: `${TAG} Other` } });
    await joinOrgByToken(adminToken, organization.id, 'ADMIN');
    await joinOrgByToken(organizerToken, organization.id, 'ORGANIZER');
    await joinOrgByToken(otherToken, otherOrganization.id, 'ADMIN');
  });

  afterAll(async () => {
    const ids = [organization.id, otherOrganization.id];
    await prisma.page.deleteMany({ where: { organizationId: { in: ids } } }).catch(() => {});
    await prisma.organization.deleteMany({ where: { id: { in: ids } } }).catch(() => {});
    await cleanupStaff(emails);
  });

  it('lists the seven policies, none set, linked in the footer by default', async () => {
    const res = await request(app).get(PATH).set(...auth(organizerToken));
    expect(res.status).toBe(200);
    expect(res.body.showInFooter).toBe(true);
    expect(res.body.policies.map((p) => p.type)).toEqual([
      'REFUND', 'PRIVACY', 'TERMS', 'SHIPPING', 'CONTACT', 'LEGAL_NOTICE', 'ACCESSIBILITY',
    ]);
    expect(res.body.policies.every((p) => p.status === 'NOT_SET')).toBe(true);
  });

  it('offers escaped starter text filled from the store details, never the store email, until one is saved', async () => {
    const res = await request(app).get(`${PATH}/CONTACT`).set(...auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ type: 'CONTACT', title: 'Contact information', starter: true, status: 'NOT_SET' });
    expect(res.body.content).toContain('&lt;b&gt;LLC&lt;/b&gt;');
    expect(res.body.content).not.toContain('hello@policies-ct.test');
    expect(res.body.content).toContain('Contact us');

    expect((await request(app).get(`${PATH}/NOPE`).set(...auth(adminToken))).status).toBe(404);
  });

  it('organizers read but cannot save, remove or toggle', async () => {
    const body = { title: 'Refunds', content: '<p>No refunds.</p>' };
    expect((await request(app).put(`${PATH}/REFUND`).set(...auth(organizerToken)).send(body)).status).toBe(403);
    expect((await request(app).delete(`${PATH}/REFUND`).set(...auth(organizerToken))).status).toBe(403);
    expect((await request(app).patch(PATH).set(...auth(organizerToken)).send({ showInFooter: false })).status).toBe(403);
  });

  it('validates the body', async () => {
    const res = await request(app).put(`${PATH}/REFUND`).set(...auth(adminToken)).send({ title: '', content: '' });
    expect(res.status).toBe(400);
    expect(res.body.details.map((d) => d.field).sort()).toEqual(['content', 'title']);
  });

  it('saves (sanitized), publishes as a page and links it in the public menus', async () => {
    const saved = await request(app)
      .put(`${PATH}/REFUND`)
      .set(...auth(adminToken))
      .send({ title: 'Return and refund policy', content: '<p>Refunds until doors open.</p><script>alert(1)</script>' });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ status: 'PUBLISHED', starter: false, slug: 'refund-policy' });
    expect(saved.body.content).not.toContain('<script>');

    const pub = await request(app).get(`/organizations/${organization.id}/public/pages/refund-policy`);
    expect(pub.status).toBe(200);
    expect(pub.body.page.template).toBeNull();
    expect(pub.body.page.content).toContain('Refunds until doors open.');

    const menus = await request(app).get(`/organizations/${organization.id}/public/menus`);
    expect(menus.body.policies).toEqual([
      { type: 'REFUND', title: 'Return and refund policy', href: `/organizations/${organization.slug}/pages/refund-policy` },
    ]);

    // Policy pages are edited in Settings only, never in Content › Pages.
    const pages = await request(app).get('/admin/pages').set(...auth(adminToken));
    expect(pages.body.pages.some((p) => p.slug === 'refund-policy')).toBe(false);
    const page = await prisma.page.findFirst({ where: { organizationId: organization.id, policyType: 'REFUND' } });
    expect((await request(app).get(`/admin/pages/${page.id}`).set(...auth(adminToken))).status).toBe(404);

    // Saving again updates the same page.
    const again = await request(app)
      .put(`${PATH}/REFUND`)
      .set(...auth(adminToken))
      .send({ title: 'Refunds', content: '<p>Updated.</p>' });
    expect(again.body).toMatchObject({ title: 'Refunds', slug: 'refund-policy' });
    expect(await prisma.page.count({ where: { organizationId: organization.id, policyType: 'REFUND' } })).toBe(1);
  });

  it('is scoped to the active organization', async () => {
    const res = await request(app).get(PATH).set(...auth(otherToken));
    expect(res.body.policies.every((p) => p.status === 'NOT_SET')).toBe(true);
  });

  it('hides the footer links when turned off', async () => {
    const off = await request(app).patch(PATH).set(...auth(adminToken)).send({ showInFooter: false });
    expect(off.status).toBe(200);
    expect(off.body.showInFooter).toBe(false);
    const menus = await request(app).get(`/organizations/${organization.id}/public/menus`);
    expect(menus.body.policies).toEqual([]);
    await request(app).patch(PATH).set(...auth(adminToken)).send({ showInFooter: true });
  });

  it('removing a policy deletes its page and marks it not set', async () => {
    expect((await request(app).delete(`${PATH}/REFUND`).set(...auth(adminToken))).status).toBe(204);
    const list = await request(app).get(PATH).set(...auth(adminToken));
    expect(list.body.policies.find((p) => p.type === 'REFUND').status).toBe('NOT_SET');
    expect((await request(app).get(`/organizations/${organization.id}/public/pages/refund-policy`)).status).toBe(404);
  });
});
