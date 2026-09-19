// Contract tests for Content › Blog posts (spec 026): blogs, posts, public routes.

import request from 'supertest';
import { staffToken, joinOrgByToken, cleanupStaff } from '../helpers/staff.js';

const { default: app } = await import('../../src/api/server.js');
const { prisma } = await import('@jump/db');

const TAG = 'blogs-ct';
const emails = [`organizer@${TAG}.test`, `other@${TAG}.test`];
const auth = (token) => ['Authorization', `Bearer ${token}`];
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

describe('Content › Blog posts contract', () => {
  let organization;
  let otherOrganization;
  let organizerToken;
  let otherToken;
  let newsBlog;
  let image;

  beforeAll(async () => {
    await prisma.organization
      .deleteMany({ where: { name: { startsWith: `${TAG} ` } } })
      .catch(() => {});
    organizerToken = await staffToken({ email: emails[0], role: 'ORGANIZER', name: 'Betty Roman' });
    otherToken = await staffToken({ email: emails[1], role: 'ORGANIZER' });
    organization = await prisma.organization.create({ data: { name: `${TAG} Store` } });
    otherOrganization = await prisma.organization.create({ data: { name: `${TAG} Other` } });
    await joinOrgByToken(organizerToken, organization.id, 'ORGANIZER');
    await joinOrgByToken(otherToken, otherOrganization.id, 'ORGANIZER');
    const upload = await request(app)
      .post('/admin/files')
      .set(...auth(organizerToken))
      .attach('files', PNG, { filename: 'hero.png', contentType: 'image/png' });
    image = upload.body.files[0];
  });

  afterAll(async () => {
    await prisma.organization
      .deleteMany({ where: { id: { in: [organization.id, otherOrganization.id] } } })
      .catch(() => {});
    await cleanupStaff(emails);
  });

  it('creates the default News blog on first read', async () => {
    const response = await request(app)
      .get('/admin/blogs')
      .set(...auth(organizerToken));
    expect(response.status).toBe(200);
    expect(response.body.blogs).toEqual([
      expect.objectContaining({ title: 'News', handle: 'news', postCount: 0 }),
    ]);
    newsBlog = response.body.blogs[0];
    const again = await request(app)
      .get('/admin/blogs')
      .set(...auth(organizerToken));
    expect(again.body.blogs).toHaveLength(1);
  });

  let post;

  it('creates a hidden post with sanitised content, author default and references', async () => {
    const response = await request(app)
      .post('/admin/blog-posts')
      .set(...auth(organizerToken))
      .send({
        title: 'Vendor applications open',
        content: `<h1>Big</h1><p>Apply <script>x()</script>now <img src="${image.url}" alt="Hero"></p>`,
        tags: ['vendors', ' Vendors ', 'news'],
        featuredFileId: image.id,
        seoDescription: '  Apply now  ',
      });
    expect(response.status).toBe(201);
    post = response.body;
    expect(post).toMatchObject({
      blogId: newsBlog.id,
      blog: { handle: 'news' },
      handle: 'vendor-applications-open',
      authorName: 'Betty Roman',
      tags: ['vendors', 'news'],
      isVisible: false,
      publishedAt: null,
      status: 'hidden',
      excerpt: null,
      seoTitle: null,
      seoDescription: 'Apply now',
      neighbors: { prev: null, next: null },
    });
    expect(post.content).toContain('<h2>Big</h2>');
    expect(post.content).not.toContain('script');
    expect(post.featuredFile).toMatchObject({ id: image.id, kind: 'image' });

    const file = await request(app)
      .get(`/admin/files/${image.id}`)
      .set(...auth(organizerToken));
    expect(file.body.references).toEqual([
      {
        kind: 'BLOG_POST',
        targetId: post.id,
        title: 'Vendor applications open',
        href: `/admin/content/blog-posts/${post.id}`,
      },
    ]);
    expect(file.body.referenceCount).toBe(2); // content img + featured image
  });

  it('rejects a featured image from another organization and unknown fields', async () => {
    const theirs = await request(app)
      .post('/admin/files')
      .set(...auth(otherToken))
      .attach('files', PNG, { filename: 'theirs.png', contentType: 'image/png' });
    const response = await request(app)
      .post('/admin/blog-posts')
      .set(...auth(organizerToken))
      .send({ title: 'x', featuredFileId: theirs.body.files[0].id });
    expect(response.status).toBe(400);
    const bogus = await request(app)
      .post('/admin/blog-posts')
      .set(...auth(organizerToken))
      .send({ title: 'x', bogus: 1 });
    expect(bogus.status).toBe(400);
  });

  it('stamps publishedAt on first visibility and derives scheduled status', async () => {
    const shown = await request(app)
      .patch(`/admin/blog-posts/${post.id}`)
      .set(...auth(organizerToken))
      .send({ isVisible: true });
    expect(shown.status).toBe(200);
    expect(shown.body.status).toBe('visible');
    expect(shown.body.publishedAt).toEqual(expect.any(String));

    const future = new Date(Date.now() + 86_400_000).toISOString();
    const scheduled = await request(app)
      .patch(`/admin/blog-posts/${post.id}`)
      .set(...auth(organizerToken))
      .send({ publishedAt: future });
    expect(scheduled.body.status).toBe('scheduled');

    const listed = await request(app)
      .get('/admin/blog-posts?status=scheduled')
      .set(...auth(organizerToken));
    expect(listed.body.posts.map((p) => p.id)).toEqual([post.id]);
    expect(listed.body.summary).toEqual({ all: 1, visible: 0, hidden: 0, scheduled: 1 });

    const pub = await request(app).get(
      `/organizations/${organization.id}/public/blogs/news/${post.body?.handle ?? 'vendor-applications-open'}`
    );
    expect(pub.status).toBe(404);

    const back = await request(app)
      .patch(`/admin/blog-posts/${post.id}`)
      .set(...auth(organizerToken))
      .send({ publishedAt: new Date(Date.now() - 1000).toISOString() });
    expect(back.body.status).toBe('visible');
  });

  it('re-derives the handle from the title on an empty handle and keeps uniqueness per blog', async () => {
    const second = await request(app)
      .post('/admin/blog-posts')
      .set(...auth(organizerToken))
      .send({ title: 'Vendor applications open', content: '<p>Again</p>', isVisible: true });
    expect(second.status).toBe(201);
    expect(second.body.handle).toBe('vendor-applications-open-2');

    const renamed = await request(app)
      .patch(`/admin/blog-posts/${second.body.id}`)
      .set(...auth(organizerToken))
      .send({ title: 'Recap 2026', handle: '' });
    expect(renamed.body.handle).toBe('recap-2026');

    const typed = await request(app)
      .patch(`/admin/blog-posts/${second.body.id}`)
      .set(...auth(organizerToken))
      .send({ handle: 'Our Recap!' });
    expect(typed.body.handle).toBe('our-recap');
    expect(typed.body.neighbors.next).toEqual({ id: post.id, title: 'Vendor applications open' });
  });

  it('lists with search, sort, tags endpoint and bulk actions', async () => {
    const search = await request(app)
      .get('/admin/blog-posts?q=recap')
      .set(...auth(organizerToken));
    expect(search.body.posts.map((p) => p.handle)).toEqual(['our-recap']);
    const byTag = await request(app)
      .get('/admin/blog-posts?q=vendors')
      .set(...auth(organizerToken));
    expect(byTag.body.posts.map((p) => p.id)).toEqual([post.id]);
    const byTitle = await request(app)
      .get('/admin/blog-posts?sort=title')
      .set(...auth(organizerToken));
    expect(byTitle.body.posts.map((p) => p.title)).toEqual([
      'Recap 2026',
      'Vendor applications open',
    ]);

    const tags = await request(app)
      .get('/admin/blog-posts/tags')
      .set(...auth(organizerToken));
    expect(tags.body.tags).toEqual([
      { tag: 'news', count: 1 },
      { tag: 'vendors', count: 1 },
    ]);

    const hide = await request(app)
      .post('/admin/blog-posts/bulk')
      .set(...auth(organizerToken))
      .send({ ids: [post.id, 'nope'], action: 'hide' });
    expect(hide.body).toEqual({
      affected: [post.id],
      failed: [{ id: 'nope', message: 'Blog post not found' }],
    });
    const hidden = await request(app)
      .get(`/admin/blog-posts/${post.id}`)
      .set(...auth(organizerToken));
    expect(hidden.body.status).toBe('hidden');
    await request(app)
      .post('/admin/blog-posts/bulk')
      .set(...auth(organizerToken))
      .send({ ids: [post.id], action: 'show' });
  });

  it('serves the public listing and post, hiding non-public posts', async () => {
    const listing = await request(app).get(`/organizations/${organization.id}/public/blogs/news`);
    expect(listing.status).toBe(200);
    expect(listing.body.organization).toMatchObject({ id: organization.id, name: `${TAG} Store` });
    expect(listing.body.blog).toMatchObject({ handle: 'news', title: 'News' });
    expect(listing.body.posts).toHaveLength(2);
    expect(listing.body.posts[0]).not.toHaveProperty('content');
    expect(listing.body.posts.find((p) => p.handle === 'vendor-applications-open')).toMatchObject({
      excerpt: expect.stringContaining('Apply now'),
      featuredImage: { alt: 'Vendor applications open' },
      seoTitle: 'Vendor applications open',
      seoDescription: 'Apply now',
    });

    const single = await request(app).get(
      `/organizations/${organization.id}/public/blogs/news/our-recap`
    );
    expect(single.status).toBe(200);
    expect(single.body.post.content).toBe('<p>Again</p>');

    await request(app)
      .post('/admin/blog-posts/bulk')
      .set(...auth(organizerToken))
      .send({ ids: [post.id], action: 'hide' });
    const gone = await request(app).get(
      `/organizations/${organization.id}/public/blogs/news/vendor-applications-open`
    );
    expect(gone.status).toBe(404);
    const missingBlog = await request(app).get(
      `/organizations/${organization.id}/public/blogs/nope`
    );
    expect(missingBlog.status).toBe(404);
  });

  it('gates public content on private stores', async () => {
    await prisma.organization.update({
      where: { id: organization.id },
      data: { storefrontPrivate: true, storefrontPasswordHash: 'x' },
    });
    const locked = await request(app).get(`/organizations/${organization.id}/public/blogs/news`);
    expect(locked.status).toBe(403);
    expect(locked.body.details?.locked).toBe(true);
    await prisma.organization.update({
      where: { id: organization.id },
      data: { storefrontPrivate: false, storefrontPasswordHash: null },
    });
  });

  it('serves visible pages publicly and sanitises page content on write', async () => {
    const page = await request(app)
      .post('/admin/pages')
      .set(...auth(organizerToken))
      .send({ title: 'FAQ', content: '<p>Hi<script>x()</script></p>', isVisible: true });
    expect(page.body.content).toBe('<p>Hi</p>');
    const pub = await request(app).get(`/organizations/${organization.id}/public/pages/faq`);
    expect(pub.status).toBe(200);
    expect(pub.body.page).toMatchObject({ title: 'FAQ', slug: 'faq', content: '<p>Hi</p>' });
    await request(app)
      .put(`/admin/pages/${page.body.id}`)
      .set(...auth(organizerToken))
      .send({ isVisible: false });
    expect(
      (await request(app).get(`/organizations/${organization.id}/public/pages/faq`)).status
    ).toBe(404);
  });

  it('manages blogs: create, rename, refuse delete with posts, move and delete', async () => {
    const created = await request(app)
      .post('/admin/blogs')
      .set(...auth(organizerToken))
      .send({ title: 'Skin Tips' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ title: 'Skin Tips', handle: 'skin-tips', postCount: 0 });

    const renamed = await request(app)
      .patch(`/admin/blogs/${created.body.id}`)
      .set(...auth(organizerToken))
      .send({ title: 'Tips', handle: '' });
    expect(renamed.body).toMatchObject({ title: 'Tips', handle: 'tips' });

    const refused = await request(app)
      .delete(`/admin/blogs/${newsBlog.id}`)
      .set(...auth(organizerToken));
    expect(refused.status).toBe(409);

    const moved = await request(app)
      .delete(`/admin/blogs/${newsBlog.id}?moveToBlogId=${created.body.id}`)
      .set(...auth(organizerToken));
    expect(moved.status).toBe(204);
    const list = await request(app)
      .get('/admin/blogs')
      .set(...auth(organizerToken));
    expect(list.body.blogs).toEqual([
      expect.objectContaining({ id: created.body.id, postCount: 2 }),
    ]);

    const last = await request(app)
      .delete(`/admin/blogs/${created.body.id}`)
      .set(...auth(organizerToken));
    expect(last.status).toBe(400);
  });

  it('isolates organizations and deletes posts with their references', async () => {
    const cross = await request(app)
      .get(`/admin/blog-posts/${post.id}`)
      .set(...auth(otherToken));
    expect(cross.status).toBe(404);
    const otherList = await request(app)
      .get('/admin/blog-posts')
      .set(...auth(otherToken));
    expect(otherList.body.total).toBe(0);

    const del = await request(app)
      .delete(`/admin/blog-posts/${post.id}`)
      .set(...auth(organizerToken));
    expect(del.status).toBe(204);
    const file = await request(app)
      .get(`/admin/files/${image.id}`)
      .set(...auth(organizerToken));
    expect(file.body.references).toEqual([]);
  });
});
