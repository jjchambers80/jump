import { expect, test, type Page } from '@playwright/test';

// Private storefront (Online store › Preferences › Store access): the public
// organization page shows the password gate until the visitor unlocks it.

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';
const ORG_ID = 'org-private';
const TOKEN = 'storefront-token-1';

function organization() {
  return { id: ORG_ID, name: 'Private Retro Club', logoUrl: null, coverUrl: null, brandColor: null, themeMode: 'LIGHT' };
}

async function mockPrivateStore(page: Page, message: string | null) {
  const unlockAttempts: string[] = [];
  await page.route(`${API}/organizations/${ORG_ID}/public`, (route) => {
    const unlocked = route.request().headers()['x-storefront-access'] === TOKEN;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        unlocked
          ? { organization: organization(), locked: false, events: [] }
          : { organization: organization(), locked: true, message, events: [] }
      ),
    });
  });
  await page.route(`${API}/organizations/${ORG_ID}/storefront-access`, (route) => {
    const { password } = route.request().postDataJSON() as { password: string };
    unlockAttempts.push(password);
    if (password !== 'retro-1985') {
      return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'Incorrect password' }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ token: TOKEN }) });
  });
  return { unlockAttempts };
}

test('shows the organizer message, rejects a wrong password, unlocks with the right one and remembers it', async ({ page }) => {
  const { unlockAttempts } = await mockPrivateStore(page, 'Opening soon — members only for now.');
  await page.goto(`/organizations/${ORG_ID}`);

  const gate = page.getByTestId('storefront-password-gate');
  await expect(gate.getByRole('heading', { name: 'Private Retro Club', level: 1 })).toBeVisible();
  await expect(page.getByTestId('storefront-message')).toHaveText('Opening soon — members only for now.');
  await expect(page.getByTestId('organization-header')).toHaveCount(0);

  await gate.getByLabel('Password').fill('nope');
  await gate.getByRole('button', { name: 'Enter store' }).click();
  await expect(gate.getByRole('alert')).toHaveText('Incorrect password. Try again.');

  await gate.getByLabel('Password').fill('retro-1985');
  await gate.getByRole('button', { name: 'Enter store' }).click();
  await expect(page.getByTestId('organization-header')).toBeVisible();
  await expect(page.getByText('No upcoming events')).toBeVisible();
  expect(unlockAttempts).toEqual(['nope', 'retro-1985']);

  // The token is kept for the next visit.
  await page.reload();
  await expect(page.getByTestId('organization-header')).toBeVisible();
  await expect(page.getByTestId('storefront-password-gate')).toHaveCount(0);
});

test('falls back to a default message when the organizer left it blank', async ({ page }) => {
  await mockPrivateStore(page, null);
  await page.goto(`/organizations/${ORG_ID}`);
  await expect(page.getByTestId('storefront-message')).toHaveText('This store is private. Enter the password to continue.');
});
