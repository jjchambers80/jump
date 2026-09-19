// Content › Blog posts (spec 026): list, editor with save bar, scheduling,
// prev/next with dirty guard, bulk actions — backend mocked.

import { expect, test, type Page } from '@playwright/test';
import { signInAsStaff } from './helpers/session';

const API = 'http://localhost:3002';
const ORG_ID = 'org-blog';

interface Post {
  id: string;
  organizationId: string;
  blogId: string;
  blog: { id: string; title: string; handle: string };
  title: string;
  handle: string;
  content: string;
  excerpt: string | null;
  authorName: string;
  tags: string[];
  featuredFileId: string | null;
  featuredFile: null;
  isVisible: boolean;
  publishedAt: string | null;
  status: 'visible' | 'hidden' | 'scheduled';
  seoTitle: string | null;
  seoDescription: string | null;
  createdAt: string;
  updatedAt: string;
}

const NEWS = {
  id: 'blog-news',
  organizationId: ORG_ID,
  title: 'News',
  handle: 'news',
  postCount: 2,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

function post(overrides: Partial<Post> & Pick<Post, 'id' | 'title'>): Post {
  const isVisible = overrides.isVisible ?? true;
  const publishedAt =
    overrides.publishedAt === undefined ? '2026-09-10T12:00:00.000Z' : overrides.publishedAt;
  const status = !isVisible
    ? 'hidden'
    : publishedAt && new Date(publishedAt) > new Date()
      ? 'scheduled'
      : 'visible';
  return {
    organizationId: ORG_ID,
    blogId: NEWS.id,
    blog: { id: NEWS.id, title: NEWS.title, handle: NEWS.handle },
    handle: overrides.title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    content: '<p>Body</p>',
    excerpt: null,
    authorName: 'Betty Roman',
    tags: [],
    featuredFileId: null,
    featuredFile: null,
    isVisible,
    publishedAt,
    status,
    seoTitle: null,
    seoDescription: null,
    createdAt: '2026-09-10T12:00:00.000Z',
    updatedAt: '2026-09-18T12:00:00.000Z',
    ...overrides,
  };
}

function withNeighbors(posts: Post[], current: Post) {
  const index = posts.findIndex((p) => p.id === current.id);
  const prev = index > 0 ? { id: posts[index - 1].id, title: posts[index - 1].title } : null;
  const next =
    index < posts.length - 1 ? { id: posts[index + 1].id, title: posts[index + 1].title } : null;
  return { ...current, neighbors: { prev, next } };
}

async function mockBlogApi(page: Page, initial: Post[]) {
  const posts = [...initial];
  const calls: { method: string; url: string; body?: Record<string, unknown> }[] = [];

  await page.route(`${API}/organizations`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: ORG_ID,
          name: 'Blog Org',
          slug: 'blog-org',
          status: 'ACTIVE',
          createdAt: '2026-09-01T00:00:00.000Z',
          updatedAt: '2026-09-01T00:00:00.000Z',
        },
      ]),
    })
  );
  await page.route(`${API}/admin/blogs**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ blogs: [NEWS] }),
    })
  );
  // Playwright runs later-registered routes first: the catch-all goes first.
  await page.route(`${API}/admin/blog-posts**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    calls.push({
      method: request.method(),
      url: request.url(),
      body: request.method() === 'POST' ? request.postDataJSON() : undefined,
    });
    if (request.method() === 'POST') {
      const body = request.postDataJSON() as Partial<Post> & { title: string };
      const created = post({
        ...body,
        id: `post-${posts.length + 1}`,
        title: body.title,
        isVisible: body.isVisible ?? false,
        publishedAt: body.publishedAt ?? null,
      });
      posts.unshift(created);
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(withNeighbors(posts, created)),
      });
    }
    const status = url.searchParams.get('status');
    const q = (url.searchParams.get('q') || '').toLowerCase();
    const list = posts.filter(
      (p) => (!status || p.status === status) && (!q || p.title.toLowerCase().includes(q))
    );
    const summary = {
      all: posts.length,
      visible: posts.filter((p) => p.status === 'visible').length,
      hidden: posts.filter((p) => p.status === 'hidden').length,
      scheduled: posts.filter((p) => p.status === 'scheduled').length,
    };
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ posts: list, total: list.length, page: 1, pageSize: 25, summary }),
    });
  });

  await page.route(`${API}/admin/blog-posts/*`, async (route) => {
    const request = route.request();
    const id = new URL(request.url()).pathname.split('/').pop()!;
    const existing = posts.find((p) => p.id === id);
    calls.push({
      method: request.method(),
      url: request.url(),
      body: request.method() === 'PATCH' ? request.postDataJSON() : undefined,
    });
    if (!existing)
      return route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Blog post not found' }),
      });
    if (request.method() === 'DELETE') {
      posts.splice(posts.indexOf(existing), 1);
      return route.fulfill({ status: 204, body: '' });
    }
    if (request.method() === 'PATCH') {
      const body = request.postDataJSON() as Partial<Post>;
      Object.assign(existing, body, { updatedAt: '2026-09-19T12:00:00.000Z' });
      if (body.isVisible !== undefined || body.publishedAt !== undefined) {
        existing.status = !existing.isVisible
          ? 'hidden'
          : existing.publishedAt && new Date(existing.publishedAt) > new Date()
            ? 'scheduled'
            : 'visible';
        if (existing.isVisible && !existing.publishedAt)
          existing.publishedAt = '2026-09-19T12:00:00.000Z';
      }
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(withNeighbors(posts, existing)),
    });
  });
  await page.route(`${API}/admin/blog-posts/tags**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ tags: [{ tag: 'vendors', count: 1 }] }),
    })
  );
  await page.route(`${API}/admin/blog-posts/bulk**`, async (route) => {
    const body = route.request().postDataJSON() as { ids: string[]; action: string };
    calls.push({ method: 'POST', url: route.request().url(), body });
    for (const id of body.ids) {
      const item = posts.find((p) => p.id === id);
      if (!item) continue;
      if (body.action === 'delete') posts.splice(posts.indexOf(item), 1);
      if (body.action === 'hide') Object.assign(item, { isVisible: false, status: 'hidden' });
      if (body.action === 'show') Object.assign(item, { isVisible: true, status: 'visible' });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ affected: body.ids, failed: [] }),
    });
  });
  return { calls, posts };
}

const fixtures = [
  post({ id: 'post-recap', title: 'Recap 2026', tags: ['recap'] }),
  post({
    id: 'post-vendors',
    title: 'Vendor applications open',
    isVisible: false,
    publishedAt: null,
  }),
];

test.beforeEach(async ({ page, baseURL }) => {
  await signInAsStaff(
    page,
    { id: 'blog-admin', email: 'blog-admin@test.com', role: 'ADMIN', name: 'Betty Roman' },
    baseURL!
  );
});

test('lists posts with visibility pills, tabs and search', async ({ page }) => {
  await mockBlogApi(page, fixtures);
  await page.goto('/admin/content/blog-posts');
  await expect(page.getByRole('heading', { name: 'Blog posts' })).toBeVisible();
  const rows = page.getByTestId('post-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('Recap 2026');
  await expect(rows.nth(0).getByTestId('status-pill')).toHaveText('Visible');
  await expect(rows.nth(1).getByTestId('status-pill')).toHaveText('Hidden');
  await expect(rows.nth(0)).toContainText('Betty Roman');
  await expect(rows.nth(0)).toContainText('News');

  await page.getByRole('tab', { name: /Hidden/ }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.nth(0)).toContainText('Vendor applications open');
  await page.getByRole('tab', { name: /All/ }).click();
  await page.getByLabel('Search blog posts').fill('recap');
  await expect(rows).toHaveCount(1);
});

test('creates a post through the editor and save bar, then schedules it', async ({ page }) => {
  const { calls } = await mockBlogApi(page, fixtures);
  await page.goto('/admin/content/blog-posts/new');
  await expect(page.getByRole('heading', { name: 'Add blog post' })).toBeVisible();
  await expect(page.getByTestId('save-bar')).toHaveCount(0);

  await page.getByLabel('Title', { exact: true }).fill('Line-up announced');
  const editor = page.getByTestId('post-content-editor').getByRole('textbox');
  await editor.click();
  await page.keyboard.type('Big news ');
  await page.getByRole('button', { name: 'Bold' }).click();
  await page.keyboard.type('today');
  await expect(page.getByLabel('Author')).toHaveValue('Betty Roman');
  await page.getByLabel('Tags').fill('lineup');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('save-bar')).toBeVisible();
  await page.getByTestId('save-bar').getByRole('button', { name: 'Save' }).click();

  await expect(page).toHaveURL(/\/admin\/content\/blog-posts\/post-3$/);
  const created = calls.find((call) => call.method === 'POST' && !call.url.includes('bulk'));
  expect(created?.body).toEqual(
    expect.objectContaining({
      title: 'Line-up announced',
      authorName: 'Betty Roman',
      tags: ['lineup'],
      isVisible: false,
      blogId: 'blog-news',
    })
  );
  expect(String(created?.body?.content)).toContain('<strong>today</strong>');
  await expect(page.getByTestId('save-bar')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Line-up announced' })).toBeVisible();

  await page.getByRole('radio', { name: /^Visible/ }).check();
  await page.getByLabel('Publish date').fill('2030-01-01T09:00');
  await expect(page.getByText('A future date keeps the post scheduled until then.')).toBeVisible();
  await page.getByTestId('save-bar').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('toast')).toContainText('Saved');
  const patch = calls.find((call) => call.method === 'PATCH');
  expect(patch?.body).toEqual(
    expect.objectContaining({ isVisible: true, publishedAt: expect.stringMatching(/^2030-01-01T/) })
  );
  await expect(page.getByTestId('post-header').getByTestId('status-pill')).toHaveText('Scheduled');
  await expect(page.getByRole('button', { name: 'View' })).toBeDisabled();
});

test('navigates between posts with the arrows and guards unsaved changes', async ({ page }) => {
  await mockBlogApi(page, fixtures);
  await page.goto('/admin/content/blog-posts/post-recap');
  await expect(page.getByRole('heading', { name: 'Recap 2026' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'View' })).toHaveAttribute(
    'href',
    '/organizations/org-blog/blogs/news/recap-2026'
  );
  await expect(page.getByRole('button', { name: 'No previous post' })).toBeDisabled();

  await page.getByLabel('Title', { exact: true }).fill('Recap 2026 (edited)');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: 'Next: Vendor applications open' }).click();
  await expect(page).toHaveURL(/post-recap$/);

  await page.getByTestId('save-bar').getByRole('button', { name: 'Discard' }).click();
  await expect(page.getByTestId('save-bar')).toHaveCount(0);
  await page.getByRole('button', { name: 'Next: Vendor applications open' }).click();
  await expect(page).toHaveURL(/post-vendors$/);
  await expect(page.getByRole('heading', { name: 'Vendor applications open' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'No next post' })).toBeDisabled();
});

test('bulk hides and deletes from the list', async ({ page }) => {
  const { calls } = await mockBlogApi(page, fixtures);
  await page.goto('/admin/content/blog-posts');
  await page.getByLabel('Select all blog posts').check();
  await page.getByTestId('bulk-bar').getByRole('button', { name: 'Set as hidden' }).click();
  await expect(page.getByTestId('toast')).toContainText('2 posts set as hidden');
  expect(calls.find((call) => call.url.includes('bulk'))?.body).toEqual({
    ids: ['post-recap', 'post-vendors'],
    action: 'hide',
  });

  await page.getByLabel('Select Recap 2026').check();
  await page.getByTestId('bulk-bar').getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByTestId('post-row')).toHaveCount(1);
});

test('deletes a post from the editor', async ({ page }) => {
  const { calls } = await mockBlogApi(page, fixtures);
  await page.goto('/admin/content/blog-posts/post-vendors');
  await page.getByRole('button', { name: 'Delete blog post' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page).toHaveURL(/\/admin\/content\/blog-posts$/);
  expect(calls.some((call) => call.method === 'DELETE' && call.url.includes('/post-vendors'))).toBe(
    true
  );
});
