// Spec 042: a page using the contact template renders a contact form that
// posts to the public contact route. Backend mocked.

import { expect, test, type Page } from '@playwright/test';

const API = 'http://localhost:3002';
const ORG = { id: 'org-contact', name: 'Contact Org', logoUrl: null, coverUrl: null, brandColor: '#0f766e', themeMode: 'SYSTEM' };

async function mockPage(page: Page, { available = true } = {}) {
  await page.route(`${API}/organizations/org-contact/public/pages/contact`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        organization: ORG,
        page: {
          id: 'pg-contact',
          title: 'Contact',
          slug: 'contact',
          content: '<p>We answer within two days.</p>',
          template: {
            name: 'contact',
            sections: [
              { type: 'page_content' },
              {
                type: 'contact_form',
                settings: {
                  heading: 'Get in touch',
                  intro: 'Questions? Send us a message.',
                  submitLabel: 'Send message',
                  successMessage: "Thanks for your message. We'll get back to you soon.",
                  showPhone: true,
                  showSubject: true,
                },
              },
            ],
          },
          contactFormAvailable: available,
        },
      }),
    })
  );
  const posts: Record<string, unknown>[] = [];
  await page.route(`${API}/organizations/org-contact/public/pages/contact/contact`, (route) => {
    posts.push(route.request().postDataJSON());
    return route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });
  return { posts };
}

test('renders the page content then the contact form, validates and sends', async ({ page }) => {
  const api = await mockPage(page);
  await page.goto('/organizations/org-contact/pages/contact');

  const article = page.getByTestId('storefront-page');
  await expect(article.getByRole('heading', { level: 1 })).toHaveText('Contact');
  await expect(article).toContainText('We answer within two days.');
  const form = page.getByRole('region', { name: 'Get in touch' });
  await expect(form).toContainText('Questions? Send us a message.');

  await form.getByRole('button', { name: 'Send message' }).click();
  await expect(form.getByText('Enter your name')).toBeVisible();
  await expect(form.getByLabel('Name')).toBeFocused();
  expect(api.posts).toHaveLength(0);

  await form.getByLabel('Name').fill('Ada Lovelace');
  await form.getByLabel('Email').fill('ada@example.com');
  await form.getByLabel(/Phone/).fill('555-0100');
  await form.getByLabel(/Subject/).fill('Booths');
  await form.getByLabel('Message').fill('Is there power at the booths?');
  await form.getByRole('button', { name: 'Send message' }).click();

  await expect(form.getByRole('status')).toContainText("Thanks for your message. We'll get back to you soon.");
  expect(api.posts[0]).toEqual({
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    phone: '555-0100',
    subject: 'Booths',
    message: 'Is there power at the booths?',
    website: '',
  });
});

test('says the form is unavailable when the store has no email', async ({ page }) => {
  await mockPage(page, { available: false });
  await page.goto('/organizations/org-contact/pages/contact');
  const form = page.getByRole('region', { name: 'Get in touch' });
  await expect(form).toContainText('This form is not available right now.');
  await expect(form.getByRole('button', { name: 'Send message' })).toHaveCount(0);
});
