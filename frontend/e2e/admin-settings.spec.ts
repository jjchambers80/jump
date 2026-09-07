import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const people = [
  {
    id: 'person-betty',
    firstName: 'Betty',
    lastName: 'Roman',
    isAccountRepresentative: true,
  },
  {
    id: 'person-jordan',
    firstName: 'Jordan',
    lastName: 'Lee',
    isAccountRepresentative: false,
  },
];

const businessDetails = {
  id: 'org-settings',
  name: 'Roman Skin Care LLC',
  businessType: 'SINGLE_MEMBER_LLC',
  nickname: 'Roman',
  countryCode: 'US',
  addressLine1: '1 Main Street',
  addressLine2: null,
  city: 'Cary',
  state: 'NC',
  postalCode: '27511',
  phoneCountryCode: '+1',
  phoneNumber: '9194639575',
  hasEin: true,
  einMasked: '••-•••0063',
};

async function mockAdminSession(page: Page) {
  await page.route('**/api/auth/session', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: { id: 'settings-admin', email: 'settings-admin@test.com', role: 'ADMIN' },
        accessToken: 'settings-test-token',
        expires: '2099-01-01T00:00:00.000Z',
      }),
    })
  );
}

async function mockSettingsApi(page: Page, initialPeople: typeof people = []) {
  let current = { ...businessDetails };
  let submitted: Record<string, unknown> | null = null;

  await page.route('http://localhost:3002/admin/settings/people', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ people: initialPeople }),
      });
      return;
    }
    await route.fallback();
  });

  await page.route('http://localhost:3002/admin/settings/business-details', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(current) });
      return;
    }

    submitted = route.request().postDataJSON();
    current = {
      ...current,
      ...(submitted as object),
      hasEin: submitted && Object.prototype.hasOwnProperty.call(submitted, 'ein') ? true : current.hasEin,
      einMasked: submitted && Object.prototype.hasOwnProperty.call(submitted, 'ein') ? '••-•••4321' : current.einMasked,
    };
    delete (current as Record<string, unknown>).ein;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(current) });
  });

  return { submitted: () => submitted };
}

test.beforeEach(async ({ page }) => {
  await mockAdminSession(page);
});

test('places Settings in the sidebar footer and renders General business details', async ({ page }) => {
  await mockSettingsApi(page);
  await page.goto('/admin/settings');

  const sidebar = page.locator('aside');
  const settingsLink = sidebar.getByRole('link', { name: 'Settings' });
  await expect(settingsLink).toBeVisible();
  await expect(settingsLink).toHaveAttribute('href', '/admin/settings');
  await expect(settingsLink).toHaveClass(/bg-indigo/);
  await expect(sidebar.getByRole('link', { name: /Create Event/i })).toHaveCount(0);
  await expect(sidebar.locator('nav').getByRole('link', { name: 'Settings' })).toHaveCount(0);

  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'General' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { name: 'Roman Skin Care LLC' })).toBeVisible();
  await expect(page.getByText('Business details')).toBeVisible();
  await expect(page.getByText('••-•••0063')).toBeVisible();
  await expect(page.getByText('Not provided')).toBeVisible();
});

test('edits and saves business details without resubmitting an unchanged EIN', async ({ page }) => {
  const api = await mockSettingsApi(page);
  await page.goto('/admin/settings');

  const editButton = page.getByRole('button', { name: 'Edit business details' });
  await editButton.click();

  const dialog = page.getByRole('dialog', { name: 'Edit business details' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Registered legal business name')).toHaveValue('Roman Skin Care LLC');
  await expect(dialog.getByLabel('Employer Identification Number (EIN)')).toHaveAttribute(
    'placeholder',
    '••-•••0063'
  );

  await dialog.getByLabel('Registered legal business name').fill('Roman Skin Studio LLC');
  await dialog.getByLabel('Business address').fill('24 Oak Avenue');
  await dialog.getByLabel('Phone number').fill('(919) 555-1212');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Roman Skin Studio LLC' })).toBeVisible();
  expect(api.submitted()).toMatchObject({
    name: 'Roman Skin Studio LLC',
    addressLine1: '24 Oak Avenue',
    phoneNumber: '9195551212',
  });
  expect(api.submitted()).not.toHaveProperty('ein');
});

test('validates ZIP, phone, and EIN before saving', async ({ page }) => {
  await mockSettingsApi(page);
  await page.goto('/admin/settings');
  await page.getByRole('button', { name: 'Edit business details' }).click();

  const dialog = page.getByRole('dialog', { name: 'Edit business details' });
  await dialog.getByLabel('ZIP code').fill('123');
  await dialog.getByLabel('Phone number').fill('555');
  await dialog.getByLabel('Employer Identification Number (EIN)').fill('12-3');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();

  await expect(dialog.getByText('Enter a 5-digit ZIP code or ZIP+4.')).toBeVisible();
  await expect(dialog.getByText('Enter a 10-digit phone number.')).toBeVisible();
  await expect(dialog.getByText('Enter a 9-digit EIN.')).toBeVisible();
});

test('renders people summaries without exposing date of birth', async ({ page }) => {
  await mockSettingsApi(page, people);
  await page.goto('/admin/settings');
  await page.getByRole('button', { name: 'Edit business details' }).click();

  const dialog = page.getByRole('dialog', { name: 'Edit business details' });
  const section = dialog.getByRole('region', { name: 'People' });
  await expect(section.getByRole('heading', { name: 'People' })).toBeVisible();
  await expect(section.getByText('Add account representative, all owners, executives and directors')).toBeVisible();
  await expect(section.getByText('BR', { exact: true })).toBeVisible();
  await expect(section.getByText('Betty Roman', { exact: true })).toBeVisible();
  await expect(section.getByText('Account Representative', { exact: true })).toHaveCount(1);
  await expect(section.getByText('Jordan Lee', { exact: true })).toBeVisible();
  await expect(section.getByText('Business person', { exact: true })).toBeVisible();
  await expect(section.getByRole('button', { name: 'Add', exact: true })).toBeVisible();
  await expect(section.getByText(/date of birth|2000-02-29/i)).toHaveCount(0);
});

test('Add person validates a canonical date and replaces the representative', async ({ page }) => {
  let posted: Record<string, unknown> | null = null;
  await mockSettingsApi(page, people);
  await page.route('http://localhost:3002/admin/settings/people', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    posted = route.request().postDataJSON();
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'person-alex',
        firstName: 'Alex',
        lastName: 'Rivera',
        isAccountRepresentative: true,
      }),
    });
  });
  await page.goto('/admin/settings');
  await page.getByRole('button', { name: 'Edit business details' }).click();

  const parent = page.getByRole('dialog', { name: 'Edit business details' });
  const addTrigger = parent.getByRole('button', { name: 'Add', exact: true });
  await addTrigger.click();
  const child = page.getByRole('dialog', { name: 'Add person' });
  await expect(child).toBeVisible();
  await expect(child.getByLabel('First name')).toBeFocused();
  await expect(child.getByLabel('Last name')).toBeVisible();
  await expect(child.getByLabel('Month')).toBeVisible();
  await expect(child.getByRole('textbox', { name: 'DD', exact: true })).toBeVisible();
  await expect(child.getByRole('textbox', { name: 'YYYY', exact: true })).toBeVisible();
  await expect(child.getByRole('checkbox', { name: 'Assign as account representative' })).toBeVisible();
  await expect(child.getByText('Currently set to Betty Roman.')).toBeVisible();
  await expect(child.getByRole('button', { name: 'Add', exact: true })).toBeDisabled();
  await expect(child.getByText(/Show optional fields|Ownership|Job title|Email|Phone|Tax ID|SSN/i)).toHaveCount(0);

  await child.getByLabel('First name').fill(' Alex ');
  await child.getByLabel('Last name').fill(' Rivera ');
  await child.getByLabel('Month').selectOption('01');
  await child.getByRole('textbox', { name: 'DD', exact: true }).fill('01');
  await child.getByRole('textbox', { name: 'YYYY', exact: true }).fill('2999');
  await child.getByRole('checkbox', { name: 'Assign as account representative' }).check();
  await child.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(child.getByText('Date of birth cannot be in the future.')).toBeVisible();
  expect(posted).toBeNull();

  await child.getByLabel('Month').selectOption('02');
  await child.getByRole('textbox', { name: 'DD', exact: true }).fill('30');
  await child.getByRole('textbox', { name: 'YYYY', exact: true }).fill('2000');
  await child.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(child.getByText('Enter a valid date of birth.')).toBeVisible();
  expect(posted).toBeNull();

  await child.getByRole('textbox', { name: 'DD', exact: true }).fill('29');
  await child.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(child).toBeHidden();
  expect(posted).toEqual({
    firstName: 'Alex',
    lastName: 'Rivera',
    dateOfBirth: '2000-02-29',
    isAccountRepresentative: true,
  });
  await expect(parent.getByText('Alex Rivera', { exact: true })).toBeVisible();
  await expect(parent.getByText('Account Representative', { exact: true })).toHaveCount(1);
  await expect(parent.getByText('Betty Roman', { exact: true }).locator('..').getByText('Business person')).toBeVisible();
  await expect(addTrigger).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(parent).toBeHidden();
});

test('retries loading and removes a person only after confirmed DELETE success', async ({ page }) => {
  let gets = 0;
  let deletes = 0;
  await mockSettingsApi(page);
  await page.route('**/admin/settings/people**', async (route) => {
    if (route.request().method() === 'GET') {
      gets += 1;
      await route.fulfill(
        gets === 1
          ? { status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Nope' }) }
          : { status: 200, contentType: 'application/json', body: JSON.stringify({ people: [people[0]] }) }
      );
      return;
    }
    if (route.request().method() === 'DELETE') {
      deletes += 1;
      await route.fulfill(deletes === 1
        ? { status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Delete failed' }) }
        : { status: 204 });
      return;
    }
    await route.fallback();
  });
  await page.goto('/admin/settings');
  await page.getByRole('button', { name: 'Edit business details' }).click();
  const parent = page.getByRole('dialog', { name: 'Edit business details' });
  await expect(parent.getByRole('alert')).toContainText('Unable to load people.');
  await parent.getByRole('button', { name: 'Retry' }).click();
  await expect(parent.getByText('Betty Roman', { exact: true })).toBeVisible();

  page.once('dialog', (dialog) => dialog.dismiss());
  await parent.getByRole('button', { name: 'Remove Betty Roman' }).click();
  expect(deletes).toBe(0);
  await expect(parent.getByText('Betty Roman', { exact: true })).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept());
  await parent.getByRole('button', { name: 'Remove Betty Roman' }).click();
  await expect(parent.getByText('Betty Roman', { exact: true })).toBeVisible();
  await expect(parent.getByRole('alert')).toContainText('Unable to remove Betty Roman.');

  page.once('dialog', (dialog) => dialog.accept());
  await parent.getByRole('button', { name: 'Remove Betty Roman' }).click();
  await expect(parent.getByText('Betty Roman', { exact: true })).toHaveCount(0);
  expect(deletes).toBe(2);
  await expect(parent.getByRole('status')).toContainText('Betty Roman removed.');
});

test('keeps Add person values after an API failure and discards them on Cancel', async ({ page }) => {
  await mockSettingsApi(page);
  await page.route('http://localhost:3002/admin/settings/people', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Unable to create person.' }) });
      return;
    }
    await route.fallback();
  });
  await page.goto('/admin/settings');
  await page.getByRole('button', { name: 'Edit business details' }).click();
  const parent = page.getByRole('dialog', { name: 'Edit business details' });
  const addTrigger = parent.getByRole('button', { name: 'Add', exact: true });
  await expect(parent.getByText('No people added yet.')).toBeVisible();
  await addTrigger.click();
  const child = page.getByRole('dialog', { name: 'Add person' });
  await child.getByLabel('First name').fill('Taylor');
  await child.getByLabel('Last name').fill('Morgan');
  await child.getByLabel('Month').selectOption('06');
  await child.getByRole('textbox', { name: 'DD', exact: true }).fill('15');
  await child.getByRole('textbox', { name: 'YYYY', exact: true }).fill('1990');
  await child.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(child.getByRole('alert')).toContainText('Unable to create person.');
  await expect(child.getByLabel('First name')).toHaveValue('Taylor');
  await child.getByRole('button', { name: 'Cancel' }).click();
  await expect(child).toBeHidden();
  await expect(parent).toBeVisible();
  await expect(addTrigger).toBeFocused();
  await addTrigger.click();
  let reopened = page.getByRole('dialog', { name: 'Add person' });
  await expect(reopened.getByLabel('First name')).toHaveValue('');
  await reopened.getByLabel('First name').fill('Discard by close');
  await reopened.getByRole('button', { name: 'Close Add person' }).click();
  await expect(reopened).toBeHidden();
  await expect(addTrigger).toBeFocused();
  await addTrigger.click();
  reopened = page.getByRole('dialog', { name: 'Add person' });
  await expect(reopened.getByLabel('First name')).toHaveValue('');
  await reopened.getByLabel('First name').fill('Discard by Escape');
  await page.keyboard.press('Escape');
  await expect(reopened).toBeHidden();
  await expect(parent).toBeVisible();
  await expect(addTrigger).toBeFocused();
});

test('keeps the nested dialog accessible, trapped, and independent on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await mockSettingsApi(page, [{
    id: 'long-person',
    firstName: 'Alexandria-With-An-Exceptionally-Long-Name',
    lastName: 'Rivera-With-An-Exceptionally-Long-Surname',
    isAccountRepresentative: false,
  }]);
  await page.goto('/admin/settings');
  await page.getByRole('button', { name: 'Edit business details' }).click();
  const parent = page.getByRole('dialog', { name: 'Edit business details' });
  await expect(parent).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  const parentResults = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(parentResults.violations.filter((item) => ['serious', 'critical'].includes(item.impact || ''))).toEqual([]);

  const addTrigger = parent.getByRole('button', { name: 'Add', exact: true });
  await addTrigger.click();
  const child = page.getByRole('dialog', { name: 'Add person' });
  await expect(child).toBeVisible();
  await expect(page.locator('[role="dialog"][aria-labelledby="business-details-dialog-title"]')).toHaveAttribute('aria-hidden', 'true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  const childResults = await new AxeBuilder({ page }).include('[role="dialog"][aria-labelledby="add-person-title"]').analyze();
  expect(childResults.violations.filter((item) => ['serious', 'critical'].includes(item.impact || ''))).toEqual([]);

  const close = child.getByRole('button', { name: 'Close Add person' });
  await close.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(child.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(child).toBeHidden();
  await expect(parent).toBeVisible();
  await expect(addTrigger).toBeFocused();
});

test('stacks without horizontal overflow on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await mockSettingsApi(page);
  await page.goto('/admin/settings');

  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => document.documentElement.clientWidth)
  );
});
