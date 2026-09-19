// Contract tests for Content › Menus (spec 027).

import request from 'supertest';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');

const TAG = 'menus-ct';
const emails = [`organizer@${TAG}.test`, `other@${TAG}.test`];
const auth = (token) => ['Authorization', `Bearer ${token}`];

describe('Content › Menus contract', () => {
  let organization;
  let otherOrganization;
  let organizerToken;
  let otherToken;
  let page;
  let hiddenPage;
  let venue;
  let event;
  let mainMenu;

  beforeAll(async () => {
    await prisma.organization
      .deleteMany({ where: { name: { startsWith: `${TAG} ` } } })
      .catch(() => {});
    organizerToken = await staffToken({ email: emails[0], role: 'ORGANIZER' });
    otherToken = await staffToken({ email: emails[1], role: 'ORGANIZER' });
    organization = await prisma.organization.create({ data: { name: `${TAG} Store` } });
    otherOrganization = await prisma.organization.create({ data: { name: `${TAG} Other` } });
    await joinOrgByToken(organizerToken, organization.id, 'ORGANIZER');
    await joinOrgByToken(otherToken, otherOrganization.id, 'ORGANIZER');
    page = await prisma.page.create({
      data: {
        organizationId: organization.id,
        title: 'FAQ',
        slug: 'faq',
        content: '<p>x</p>',
        isVisible: true,
      },
    });
    hiddenPage = await prisma.page.create({
      data: {
        organizationId: organization.id,
        title: 'Draft',
        slug: 'draft',
        content: '<p>x</p>',
        isVisible: false,
      },
    });
    venue = await prisma.venue.create({
      data: {
        organizationId: organization.id,
        name: 'Hall',
        address: '1 St',
        city: 'Raleigh',
        state: 'NC',
      },
    });
    event = await prisma.event.create({
      data: {
        venueId: venue.id,
        name: 'Expo',
        date: new Date(Date.now() + 86_400_000),
        status: 'PUBLISHED',
        capacity: 100,
      },
    });
  });

  afterAll(async () => {
    await prisma.organization
      .deleteMany({ where: { id: { in: [organization.id, otherOrganization.id] } } })
      .catch(() => {});
    await cleanupStaff(emails);
  });

  it('creates the two default menus on first read', async () => {
    const response = await request(app)
      .get('/admin/menus')
      .set(...auth(organizerToken));
    expect(response.status).toBe(200);
    expect(response.body.menus).toEqual([
      expect.objectContaining({
        title: 'Main menu',
        handle: 'main-menu',
        isDefault: true,
        itemLabels: ['Home', 'Events'],
      }),
      expect.objectContaining({
        title: 'Footer menu',
        handle: 'footer-menu',
        isDefault: true,
        itemLabels: ['Home'],
      }),
    ]);
    mainMenu = response.body.menus[0];
    expect(
      (
        await request(app)
          .get('/admin/menus')
          .set(...auth(organizerToken))
      ).body.menus
    ).toHaveLength(2);
  });

  it('replaces the tree, resolves targets and reports broken / hidden links', async () => {
    const response = await request(app)
      .put(`/admin/menus/${mainMenu.id}`)
      .set(...auth(organizerToken))
      .send({
        title: 'Main',
        items: [
          { label: 'Home', linkType: 'HOME' },
          {
            label: 'Vendors',
            linkType: 'PAGE',
            targetId: page.id,
            children: [
              { label: 'Expo', linkType: 'EVENT', targetId: event.id },
              {
                label: 'Hall',
                linkType: 'VENUE',
                targetId: venue.id,
                children: [
                  {
                    label: 'Packet',
                    linkType: 'EXTERNAL',
                    url: 'https://x.test/p.pdf',
                    newTab: true,
                  },
                ],
              },
            ],
          },
          { label: 'Draft', linkType: 'PAGE', targetId: hiddenPage.id },
          { label: 'Account', linkType: 'ACCOUNT' },
        ],
      });
    expect(response.status).toBe(200);
    expect(response.body.title).toBe('Main');
    const [home, vendors, draft, account] = response.body.items;
    expect(home).toMatchObject({
      label: 'Home',
      target: { status: 'ok', href: `/organizations/${organization.id}` },
      children: [],
    });
    expect(vendors.target).toEqual({
      title: 'FAQ',
      status: 'ok',
      href: `/organizations/${organization.id}/pages/faq`,
    });
    expect(vendors.children.map((c) => c.label)).toEqual(['Expo', 'Hall']);
    expect(vendors.children[0].target).toEqual({
      title: 'Expo',
      status: 'ok',
      href: `/events/${event.id}`,
    });
    expect(vendors.children[1].children[0]).toMatchObject({
      label: 'Packet',
      url: 'https://x.test/p.pdf',
      newTab: true,
      target: { status: 'ok', href: 'https://x.test/p.pdf' },
    });
    expect(draft.target).toEqual({
      title: 'Draft',
      status: 'hidden',
      href: `/organizations/${organization.id}/pages/draft`,
    });
    expect(account.target.href).toBe(`/organizations/${organization.id}/account`);

    await prisma.page.delete({ where: { id: hiddenPage.id } });
    const after = await request(app)
      .get(`/admin/menus/${mainMenu.id}`)
      .set(...auth(organizerToken));
    expect(after.body.items[2].target).toEqual({ title: null, status: 'missing', href: null });
  });

  it('rejects depth 4, foreign targets and bad urls', async () => {
    const deep = await request(app)
      .put(`/admin/menus/${mainMenu.id}`)
      .set(...auth(organizerToken))
      .send({
        items: [
          {
            label: '1',
            linkType: 'HOME',
            children: [
              {
                label: '2',
                linkType: 'HOME',
                children: [
                  { label: '3', linkType: 'HOME', children: [{ label: '4', linkType: 'HOME' }] },
                ],
              },
            ],
          },
        ],
      });
    expect(deep.status).toBe(400);
    const theirsPage = await prisma.page.create({
      data: {
        organizationId: otherOrganization.id,
        title: 'Theirs',
        slug: 'theirs',
        content: '<p>x</p>',
      },
    });
    const foreign = await request(app)
      .put(`/admin/menus/${mainMenu.id}`)
      .set(...auth(organizerToken))
      .send({ items: [{ label: 'Theirs', linkType: 'PAGE', targetId: theirsPage.id }] });
    expect(foreign.status).toBe(400);
    const bad = await request(app)
      .put(`/admin/menus/${mainMenu.id}`)
      .set(...auth(organizerToken))
      .send({ items: [{ label: 'X', linkType: 'EXTERNAL', url: 'javascript:alert(1)' }] });
    expect(bad.status).toBe(400);
    // The tree is unchanged after failed saves.
    const current = await request(app)
      .get(`/admin/menus/${mainMenu.id}`)
      .set(...auth(organizerToken));
    expect(current.body.items.map((i) => i.label)).toEqual(['Home', 'Vendors', 'Draft', 'Account']);
  });

  it('serves public menus with resolved hrefs and drops unrenderable items', async () => {
    const response = await request(app).get(`/organizations/${organization.id}/public/menus`);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('public, max-age=60');
    expect(response.body.main.map((i) => i.label)).toEqual(['Home', 'Vendors', 'Account']);
    expect(response.body.main[1]).toMatchObject({
      href: `/organizations/${organization.id}/pages/faq`,
      children: [
        { label: 'Expo', href: `/events/${event.id}` },
        {
          label: 'Hall',
          href: `/venues/${venue.id}`,
          children: [{ label: 'Packet', href: 'https://x.test/p.pdf', newTab: true }],
        },
      ],
    });
    expect(response.body.footer).toEqual([
      {
        id: expect.any(String),
        label: 'Home',
        href: `/organizations/${organization.id}`,
        newTab: false,
        children: [],
      },
    ]);

    await prisma.event.update({ where: { id: event.id }, data: { status: 'DRAFT' } });
    const later = await request(app).get(`/organizations/${organization.id}/public/menus`);
    expect(later.body.main[1].children.map((c) => c.label)).toEqual(['Hall']);
  });

  it('gates public menus on private stores', async () => {
    await prisma.organization.update({
      where: { id: organization.id },
      data: { storefrontPrivate: true, storefrontPasswordHash: 'x' },
    });
    expect((await request(app).get(`/organizations/${organization.id}/public/menus`)).status).toBe(
      403
    );
    await prisma.organization.update({
      where: { id: organization.id },
      data: { storefrontPrivate: false, storefrontPasswordHash: null },
    });
  });

  it('searches link targets scoped to the organization', async () => {
    const response = await request(app)
      .get('/admin/menus/link-targets?q=a')
      .set(...auth(organizerToken));
    expect(response.status).toBe(200);
    expect(response.body.pages.map((p) => p.title)).toEqual(['FAQ']);
    expect(response.body.venues.map((v) => v.title)).toEqual(['Hall']);
    expect(response.body.events).toEqual([]); // Expo is DRAFT now
    const all = await request(app)
      .get('/admin/menus/link-targets')
      .set(...auth(organizerToken));
    expect(all.body.blogs).toEqual([]);
    expect(all.body.pages).toHaveLength(1);
  });

  it('creates, duplicates and deletes extra menus; defaults are protected', async () => {
    const created = await request(app)
      .post('/admin/menus')
      .set(...auth(organizerToken))
      .send({ title: 'Sponsors' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      title: 'Sponsors',
      handle: 'sponsors',
      isDefault: false,
      items: [],
    });

    const dup = await request(app)
      .post(`/admin/menus/${mainMenu.id}/duplicate`)
      .set(...auth(organizerToken));
    expect(dup.status).toBe(201);
    expect(dup.body).toMatchObject({
      title: 'Main copy',
      handle: 'main-menu-copy',
      isDefault: false,
    });
    expect(dup.body.items.map((i) => i.label)).toEqual(['Home', 'Vendors', 'Draft', 'Account']);
    expect(dup.body.items[1].children[1].children[0].label).toBe('Packet');

    expect(
      (
        await request(app)
          .delete(`/admin/menus/${mainMenu.id}`)
          .set(...auth(organizerToken))
      ).status
    ).toBe(400);
    expect(
      (
        await request(app)
          .delete(`/admin/menus/${dup.body.id}`)
          .set(...auth(organizerToken))
      ).status
    ).toBe(204);
    expect(
      (
        await request(app)
          .get(`/admin/menus/${created.body.id}`)
          .set(...auth(otherToken))
      ).status
    ).toBe(404);
    const list = await request(app)
      .get('/admin/menus')
      .set(...auth(organizerToken));
    expect(list.body.menus.map((m) => m.handle)).toEqual(['main-menu', 'footer-menu', 'sponsors']);
  });
});
