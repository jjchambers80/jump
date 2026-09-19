// Public blog listing, post and page (spec 026) — backend mocked.

import { expect, test } from '@playwright/test';

const API = 'http://localhost:3002';
const ORG = {
  id: 'org-pub',
  name: 'Pub Org',
  logoUrl: null,
  coverUrl: null,
  brandColor: '#b91c1c',
  themeMode: 'SYSTEM',
};
const HASH = 'a'.repeat(64);
const post = {
  id: 'p1',
  title: 'Recap 2026',
  handle: 'recap-2026',
  blog: { id: 'b1', title: 'News', handle: 'news' },
  authorName: 'Betty Roman',
  tags: ['recap', 'vendors'],
  publishedAt: '2026-09-10T12:00:00.000Z',
  excerpt: '<p>What a weekend.</p>',
  featuredImage: {
    url: `${API}/files/f1/${HASH}/hero.png`,
    previewUrl: null,
    alt: 'Crowd',
    focalX: 0.5,
    focalY: 0.2,
    width: 800,
    height: 600,
  },
  seoTitle: 'Recap 2026',
  seoDescription: 'What a weekend.',
};

test('renders the listing and the post with the organization chrome', async ({ page }) => {
  await page.route(`${API}/organizations/org-pub/public/blogs/news`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        organization: ORG,
        blog: post.blog,
        posts: [post],
        total: 1,
        page: 1,
        pageSize: 12,
      }),
    })
  );
  await page.route(`${API}/organizations/org-pub/public/blogs/news/recap-2026`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        organization: ORG,
        post: {
          ...post,
          content: '<h2>Highlights</h2><p>Thanks to <a href="https://x.test">everyone</a>.</p>',
        },
      }),
    })
  );
  await page.route(`${API}/files/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64'
      ),
    })
  );

  await page.goto('/organizations/org-pub/blogs/news');
  await expect(page.getByTestId('organization-header')).toContainText('Pub Org');
  await expect(page.getByRole('heading', { level: 1, name: 'News' })).toBeVisible();
  const card = page.getByTestId('blog-post-card');
  await expect(card).toContainText('Recap 2026');
  await expect(card).toContainText('What a weekend.');
  await expect(card).toContainText('Betty Roman');

  await card.getByRole('link', { name: 'Recap 2026' }).click();
  await expect(page).toHaveURL(/\/blogs\/news\/recap-2026$/);
  const article = page.getByTestId('blog-post');
  await expect(article.getByRole('heading', { level: 1 })).toHaveText('Recap 2026');
  await expect(article.getByRole('heading', { level: 2 })).toHaveText('Highlights');
  await expect(article.getByRole('img', { name: 'Crowd' })).toBeVisible();
  await expect(article.getByRole('link', { name: 'everyone' })).toHaveAttribute(
    'href',
    'https://x.test'
  );
  const linkColor = await article
    .getByRole('link', { name: 'everyone' })
    .evaluate((el) => getComputedStyle(el).color);
  expect(linkColor).not.toBe('rgb(37, 99, 235)'); // brand color, not the platform default
});

test('shows the not-found state for a hidden post and renders a public page', async ({ page }) => {
  await page.route(`${API}/organizations/org-pub/public/blogs/news/secret`, (route) =>
    route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Blog post not found' }),
    })
  );
  await page.goto('/organizations/org-pub/blogs/news/secret');
  await expect(page.getByRole('heading', { name: 'Post not found' })).toBeVisible();

  await page.route(`${API}/organizations/org-pub/public/pages/faq`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        organization: ORG,
        page: { id: 'pg1', title: 'FAQ', slug: 'faq', content: '<p>Doors open at 9.</p>' },
      }),
    })
  );
  await page.goto('/organizations/org-pub/pages/faq');
  await expect(page.getByTestId('storefront-page').getByRole('heading', { level: 1 })).toHaveText(
    'FAQ'
  );
  await expect(page.getByTestId('storefront-page')).toContainText('Doors open at 9.');
});
