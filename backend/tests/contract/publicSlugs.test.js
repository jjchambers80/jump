// Public resource routing: canonical slugs plus legacy id compatibility.

import request from 'supertest';
import app from '../../src/api/server.js';
import { prisma } from '@jump/db';

const tag = `public-slugs-${process.pid}`;

describe('public slug routes', () => {
  let organization;
  let venue;
  let event;
  let page;
  let blog;
  let post;

  beforeAll(async () => {
    organization = await prisma.organization.create({
      data: { name: 'Raleigh Retro Gamers', slug: `${tag}-org` },
    });
    venue = await prisma.venue.create({
      data: {
        organizationId: organization.id,
        name: 'Convention Center',
        slug: `${tag}-venue`,
        address: '1 Main St',
      },
    });
    event = await prisma.event.create({
      data: {
        venueId: venue.id,
        name: '2026 Game and Geek Expo',
        slug: `${tag}-event`,
        date: new Date('2027-10-01T18:00:00.000Z'),
        capacity: 100,
        status: 'PUBLISHED',
      },
    });
    page = await prisma.page.create({
      data: {
        organizationId: organization.id,
        title: 'About Us',
        slug: `${tag}-page`,
        content: '<p>About</p>',
        isVisible: true,
      },
    });
    blog = await prisma.blog.create({
      data: { organizationId: organization.id, title: 'News', handle: `${tag}-blog` },
    });
    post = await prisma.blogPost.create({
      data: {
        organizationId: organization.id,
        blogId: blog.id,
        title: 'Expo Preview',
        handle: `${tag}-post`,
        content: '<p>Preview</p>',
        authorName: 'Jump',
        isVisible: true,
        publishedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
  });

  afterAll(async () => {
    if (organization) {
      await prisma.blogPost.deleteMany({ where: { organizationId: organization.id } });
      await prisma.blog.deleteMany({ where: { organizationId: organization.id } });
      await prisma.page.deleteMany({ where: { organizationId: organization.id } });
      await prisma.event.deleteMany({ where: { venue: { organizationId: organization.id } } });
      await prisma.venue.deleteMany({ where: { organizationId: organization.id } });
      await prisma.organization.delete({ where: { id: organization.id } });
    }
  });

  it('resolves organizations by canonical slug and legacy id', async () => {
    const canonical = await request(app).get(`/organizations/${organization.slug}/public`);
    const legacy = await request(app).get(`/organizations/${organization.id}/public`);

    expect(canonical.status).toBe(200);
    expect(legacy.status).toBe(200);
    expect(canonical.body.organization).toMatchObject({ id: organization.id, slug: organization.slug });
    expect(legacy.body.organization).toMatchObject({ id: organization.id, slug: organization.slug });
  });

  it('resolves venues by canonical slug and legacy id', async () => {
    const canonical = await request(app).get(`/venues/${venue.slug}`);
    const legacy = await request(app).get(`/venues/${venue.id}`);

    expect(canonical.status).toBe(200);
    expect(legacy.status).toBe(200);
    expect(canonical.body.venue).toMatchObject({ id: venue.id, slug: venue.slug });
    expect(legacy.body.venue).toMatchObject({ id: venue.id, slug: venue.slug });
  });

  it('resolves events by canonical slug and legacy id', async () => {
    const canonical = await request(app).get(`/events/${event.slug}`);
    const legacy = await request(app).get(`/events/${event.id}`);

    expect(canonical.status).toBe(200);
    expect(legacy.status).toBe(200);
    expect(canonical.body).toMatchObject({ id: event.id, slug: event.slug });
    expect(legacy.body).toMatchObject({ id: event.id, slug: event.slug });
  });

  it('resolves pages by canonical slug and legacy id under either organization identifier', async () => {
    const canonical = await request(app).get(
      `/organizations/${organization.slug}/public/pages/${page.slug}`
    );
    const legacy = await request(app).get(
      `/organizations/${organization.id}/public/pages/${page.id}`
    );

    expect(canonical.status).toBe(200);
    expect(legacy.status).toBe(200);
    expect(canonical.body.organization).toMatchObject({ id: organization.id, slug: organization.slug });
    expect(canonical.body.page).toMatchObject({ id: page.id, slug: page.slug });
    expect(legacy.body.page).toMatchObject({ id: page.id, slug: page.slug });
  });

  it('resolves blog posts by canonical handle and legacy id under either organization identifier', async () => {
    const canonical = await request(app).get(
      `/organizations/${organization.slug}/public/blogs/${blog.handle}/${post.handle}`
    );
    const legacy = await request(app).get(
      `/organizations/${organization.id}/public/blogs/${blog.handle}/${post.id}`
    );

    expect(canonical.status).toBe(200);
    expect(legacy.status).toBe(200);
    expect(canonical.body.organization).toMatchObject({ id: organization.id, slug: organization.slug });
    expect(canonical.body.post).toMatchObject({ id: post.id, handle: post.handle });
    expect(legacy.body.post).toMatchObject({ id: post.id, handle: post.handle });
  });

  it('returns 404 for unknown and reserved-looking identifiers', async () => {
    expect((await request(app).get('/organizations/admin/public')).status).toBe(404);
    expect((await request(app).get('/venues/events')).status).toBe(404);
    expect((await request(app).get('/events/checkout')).status).toBe(404);
  });
});
