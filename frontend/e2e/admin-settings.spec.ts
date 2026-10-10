import { expect, test, type Page } from '@playwright/test';
import { signInAsStaff } from './helpers/session';
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
  companyName: null,
  email: 'hello@romanskincare.com',
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

// Real HS256 session cookie: the edge middleware decodes it itself, so
// mocking GET /api/auth/session alone would redirect /admin to sign-in.
async function mockAdminSession(page: Page, baseURL: string) {
  await signInAsStaff(page, { id: 'settings-admin', email: 'settings-admin@test.com', role: 'ADMIN' }, baseURL);
}

async function mockSettingsApi(page: Page, initialPeople: typeof people = []) {
  let current = { ...businessDetails };
  let submitted: Record<string, unknown> | null = null;
  let organizationsGets = 0;

  // The header switcher lists orgs from GET /organizations; the name it
  // shows comes from here, not from the settings endpoint.
  await page.route('http://localhost:3002/organizations', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    organizationsGets += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { id: current.id, name: current.name, status: 'ACTIVE', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
      ]),
    });
  });

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

  return { submitted: () => submitted, organizationsGets: () => organizationsGets };
}

test.beforeEach(async ({ page, baseURL }) => {
  await mockAdminSession(page, baseURL!);
});

test('places Settings in the sidebar footer and renders General as read-only summary cards', async ({ page }) => {
  await mockSettingsApi(page);
  await page.goto('/admin/settings');

  const sidebar = page.locator('aside');
  const settingsLink = sidebar.getByRole('link', { name: 'Settings' });
  await expect(settingsLink).toBeVisible();
  await expect(settingsLink).toHaveAttribute('href', '/admin/settings');
  await expect(settingsLink).toHaveClass(/bg-accent/);
  await expect(sidebar.getByRole('link', { name: /Create Event/i })).toHaveCount(0);
  await expect(sidebar.locator('nav').getByRole('link', { name: 'Settings' })).toHaveCount(0);

  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Settings sections' }).getByRole('link', { name: 'General' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { name: 'General', exact: true })).toBeVisible();

  // Business details card: legal entity row with an actions affordance.
  await expect(page.getByRole('heading', { name: 'Business details' })).toBeVisible();
  const businessRow = page.getByRole('button', { name: 'Edit business details' });
  await expect(businessRow).toContainText('Roman Skin Care LLC');
  await expect(businessRow).toContainText('Single Member LLC · EIN ••-•••0063');

  // Store contact details card: two rows, each opening its own editor.
  await expect(page.getByRole('heading', { name: 'Store contact details' })).toBeVisible();
  const contactRow = page.getByRole('button', { name: 'Edit store contact details' });
  await expect(contactRow).toContainText('Roman Skin Care LLC');
  await expect(contactRow).toContainText('hello@romanskincare.com · (919) 463-9575');
  const addressRow = page.getByRole('button', { name: 'Edit store address' });
  await expect(addressRow).toContainText('Store address');
  await expect(addressRow).toContainText('1 Main Street, Cary, NC 27511, United States');

  // Nothing is editable until a row is opened.
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('saving store contact details closes the dialog and updates the org switcher immediately', async ({ page }) => {
  const api = await mockSettingsApi(page);
  await page.goto('/admin/settings');

  const switcher = page.getByTestId('org-switcher-trigger');
  await expect(switcher).toContainText('Roman Skin Care LLC');

  const row = page.getByRole('button', { name: 'Edit store contact details' });
  await row.click();
  const dialog = page.getByRole('dialog', { name: 'Edit store contact details' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Store name')).toBeFocused();
  await expect(dialog.getByLabel('Store name')).toHaveValue('Roman Skin Care LLC');
  await expect(dialog.getByLabel('Store email')).toHaveValue('hello@romanskincare.com');
  await expect(dialog.getByLabel('Store phone number')).toHaveValue('9194639575');
  await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled();

  await dialog.getByLabel('Store name').fill('Roman Skin Studio');
  await dialog.getByLabel('Store email').fill(' Hello@RomanSkinStudio.com ');
  await dialog.getByLabel('Store phone number').fill('(919) 555-1212');
  await dialog.getByRole('button', { name: 'Save' }).click();

  await expect(dialog).toBeHidden();
  await expect(row).toBeFocused();
  await expect(row).toContainText('Roman Skin Studio');
  await expect(row).toContainText('hello@romanskinstudio.com · (919) 555-1212');
  await expect(page.getByRole('status')).toHaveText('Store contact details saved.');
  await expect(switcher).toContainText('Roman Skin Studio');
  expect(api.submitted()).toEqual({
    name: 'Roman Skin Studio',
    email: 'hello@romanskinstudio.com',
    phoneCountryCode: '+1',
    phoneNumber: '9195551212',
  });
  await expect.poll(api.organizationsGets).toBeGreaterThanOrEqual(2);
});

test('validates store contact details and confirms before discarding unsaved changes', async ({ page }) => {
  const api = await mockSettingsApi(page);
  await page.goto('/admin/settings');

  await page.getByRole('button', { name: 'Edit store contact details' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit store contact details' });
  await dialog.getByLabel('Store name').fill('');
  await dialog.getByLabel('Store email').fill('not-an-email');
  await dialog.getByLabel('Store phone number').fill('555');
  await dialog.getByRole('button', { name: 'Save' }).click();

  await expect(dialog.getByText('Store name is required.')).toBeVisible();
  await expect(dialog.getByText('Enter a valid email address.')).toBeVisible();
  await expect(dialog.getByText('Enter a 10-digit phone number.')).toBeVisible();
  expect(api.submitted()).toBeNull();

  // Dismissing the confirm keeps the dialog and its values.
  page.once('dialog', (confirm) => confirm.dismiss());
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Store email')).toHaveValue('not-an-email');

  // Accepting it closes without saving; the row still shows the saved values.
  page.once('dialog', (confirm) => confirm.accept());
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  const row = page.getByRole('button', { name: 'Edit store contact details' });
  await expect(row).toBeFocused();
  await expect(row).toContainText('hello@romanskincare.com');
  expect(api.submitted()).toBeNull();
});

test('saves the store address with company name as a partial payload', async ({ page }) => {
  const api = await mockSettingsApi(page);
  await page.goto('/admin/settings');

  const row = page.getByRole('button', { name: 'Edit store address' });
  await row.click();
  const dialog = page.getByRole('dialog', { name: 'Edit store address' });
  await expect(dialog.getByLabel('Company name')).toBeFocused();
  await expect(dialog.getByLabel('Company name')).toHaveValue('');
  await expect(dialog.getByLabel('Country/region')).toHaveValue('US');
  await expect(dialog.getByLabel('Address', { exact: true })).toHaveValue('1 Main Street');
  await expect(dialog.getByLabel('City')).toHaveValue('Cary');
  await expect(dialog.getByLabel('State')).toHaveValue('NC');
  await expect(dialog.getByLabel('ZIP code')).toHaveValue('27511');

  await dialog.getByLabel('Company name').fill('Roman Skin Care Holdings LLC');
  await dialog.getByLabel('Address', { exact: true }).fill('24 Oak Avenue');
  await dialog.getByLabel('Apartment, suite, etc.').fill('Suite 2');
  await dialog.getByLabel('ZIP code').fill('123');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByText('Enter a 5-digit ZIP code or ZIP+4.')).toBeVisible();
  expect(api.submitted()).toBeNull();

  await dialog.getByLabel('ZIP code').fill('27513');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('status')).toHaveText('Store address saved.');
  await expect(row).toContainText('24 Oak Avenue, Suite 2, Cary, NC 27513, United States');
  // The legal entity row picks up the company name.
  await expect(page.getByRole('button', { name: 'Edit business details' })).toContainText('Roman Skin Care Holdings LLC');
  expect(api.submitted()).toEqual({
    companyName: 'Roman Skin Care Holdings LLC',
    countryCode: 'US',
    addressLine1: '24 Oak Avenue',
    addressLine2: 'Suite 2',
    city: 'Cary',
    state: 'NC',
    postalCode: '27513',
  });
  expect(api.submitted()).not.toHaveProperty('name');
});

test('edits business details in the dialog without resubmitting an unchanged EIN', async ({ page }) => {
  const api = await mockSettingsApi(page);
  await page.goto('/admin/settings');

  const editButton = page.getByRole('button', { name: 'Edit business details' });
  await editButton.click();

  const dialog = page.getByRole('dialog', { name: 'Edit business details' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Type of business')).toHaveValue('SINGLE_MEMBER_LLC');
  await expect(dialog.getByLabel('Nickname')).toHaveValue('Roman');
  await expect(dialog.getByLabel('Employer Identification Number (EIN)')).toHaveAttribute(
    'placeholder',
    '••-•••0063'
  );
  // Store name, address, and phone are edited in their own dialogs only.
  await expect(dialog.getByLabel(/Store name|Store email|Business address|Phone number|ZIP code/)).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();

  await dialog.getByLabel('Type of business').selectOption('S_CORPORATION');
  await dialog.getByLabel('Nickname').fill('Roman Studio');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();

  await expect(dialog).toBeHidden();
  await expect(editButton).toBeFocused();
  await expect(editButton).toContainText('S corporation · EIN ••-•••0063');
  await expect(page.getByRole('status')).toHaveText('Business details saved.');
  expect(api.submitted()).toEqual({
    businessType: 'S_CORPORATION',
    nickname: 'Roman Studio',
  });
});

test('validates EIN before saving', async ({ page }) => {
  await mockSettingsApi(page);
  await page.goto('/admin/settings');
  await page.getByRole('button', { name: 'Edit business details' }).click();

  const dialog = page.getByRole('dialog', { name: 'Edit business details' });
  await dialog.getByLabel('Employer Identification Number (EIN)').fill('12-3');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();

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

// Users moved out of the main admin menu into Settings › Users.

type MockMember = {
  id: string;
  email: string;
  name: string | null;
  image: null;
  role: 'ADMIN' | 'ORGANIZER';
  status: 'ACTIVE' | 'PENDING' | 'INACTIVE';
  requireTwoStep: boolean;
  twoStepEnabled: boolean;
  invitedAt: string | null;
  joinedAt: string;
};

const member = (overrides: Partial<MockMember>): MockMember => ({
  id: 'user-1',
  email: 'jordan@test.com',
  name: 'Jordan Lee',
  image: null,
  role: 'ORGANIZER',
  status: 'ACTIVE',
  requireTwoStep: false,
  twoStepEnabled: false,
  invitedAt: null,
  joinedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

/** Settings › Users backend: GET list, POST invite, DELETE remove, POST resend. */
async function mockUsersApi(page: Page) {
  const state = {
    users: [
      member({ id: 'settings-admin', email: 'settings-admin@test.com', name: 'Sam Admin', role: 'ADMIN', twoStepEnabled: true }),
      member({}),
    ],
    invites: [] as unknown[],
    removed: [] as string[],
    resent: [] as string[],
  };
  await page.route(/localhost:3002\/admin\/settings\/users/, async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const json = (status: number, body?: unknown) =>
      route.fulfill({ status, contentType: 'application/json', body: body === undefined ? '' : JSON.stringify(body) });
    if (req.method() === 'GET') return json(200, { users: state.users });
    if (req.method() === 'POST' && path === '/admin/settings/users') {
      const body = req.postDataJSON();
      state.invites.push(body);
      for (const email of body.emails) {
        state.users.push(
          member({ id: `new-${email}`, email, name: null, role: body.role, status: 'PENDING', requireTwoStep: body.requireTwoStep, invitedAt: '2026-10-08T00:00:00.000Z' })
        );
      }
      return json(201, { invited: body.emails, alreadyMember: [], emailFailed: [] });
    }
    if (req.method() === 'POST' && path.endsWith('/resend')) {
      state.resent.push(path.split('/')[4]);
      return json(204);
    }
    if (req.method() === 'DELETE') {
      const id = path.split('/').pop()!;
      state.removed.push(id);
      state.users = state.users.filter((u) => u.id !== id);
      return json(204);
    }
    return route.fallback();
  });
  return state;
}

test('lists Users under Settings instead of the main sidebar and redirects the old URL', async ({ page }) => {
  await mockSettingsApi(page);
  await mockUsersApi(page);
  await page.goto('/admin/settings');

  const sidebar = page.locator('aside');
  await expect(sidebar.getByRole('link', { name: 'Settings' })).toBeVisible();
  await expect(sidebar.getByRole('link', { name: 'Users' })).toHaveCount(0);

  const sections = page.getByRole('navigation', { name: 'Settings sections' });
  await sections.getByRole('link', { name: 'Users' }).click();
  await expect(page).toHaveURL(/\/admin\/settings\/users$/);
  await expect(sections.getByRole('link', { name: 'Users' })).toHaveAttribute('aria-current', 'page');
  await expect(sidebar.getByRole('link', { name: 'Settings' })).toHaveClass(/bg-accent/);
  await expect(page.getByRole('heading', { name: 'Users', exact: true })).toBeVisible();
  await expect(page.getByText('jordan@test.com')).toBeVisible();
  // Organization column is gone: the list is one organization's staff
  await expect(page.getByRole('columnheader', { name: 'Organization' })).toHaveCount(0);

  await page.goto('/admin/users');
  await expect(page).toHaveURL(/\/admin\/settings\/users$/);
});

test('hides the Users section from ORGANIZER and denies direct access', async ({ page, baseURL }) => {
  await signInAsStaff(page, { id: 'settings-organizer', email: 'organizer@test.com', role: 'ORGANIZER' }, baseURL!);
  await mockSettingsApi(page);
  await mockUsersApi(page);
  await page.goto('/admin/settings');

  const sections = page.getByRole('navigation', { name: 'Settings sections' });
  await expect(sections.getByRole('link', { name: 'General' })).toBeVisible();
  await expect(sections.getByRole('link', { name: 'Users' })).toHaveCount(0);

  await page.goto('/admin/settings/users');
  await expect(page.getByText(/access denied/i)).toBeVisible();
  await expect(page.getByText(/cannot manage users/i)).toBeVisible();
});

test('adds users by email with a role and the secure sign-in requirement', async ({ page }) => {
  await mockSettingsApi(page);
  const api = await mockUsersApi(page);
  await page.goto('/admin/settings/users');

  await page.getByRole('link', { name: 'Add users' }).click();
  await expect(page).toHaveURL(/\/admin\/settings\/users\/new$/);
  await expect(page.getByRole('heading', { name: 'Add users', exact: true })).toBeVisible();

  const results = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);

  const emails = page.getByLabel('Emails');
  await emails.fill('casey@test.com, not-an-email');
  await expect(page.getByText('Check this address: not-an-email')).toBeVisible();
  await expect(emails).toHaveAttribute('aria-invalid', 'true');

  await emails.fill('casey@test.com\nRiley@Test.com, casey@test.com');
  await expect(page.getByText('2 people will be added.')).toBeVisible();

  const secure = page.getByRole('switch', { name: 'Secure sign-in method' });
  await expect(secure).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('radio', { name: /Admin/ }).check();
  await page.getByRole('button', { name: 'Add 2 users' }).click();

  await expect(page).toHaveURL(/\/admin\/settings\/users$/);
  expect(api.invites).toEqual([{ emails: ['casey@test.com', 'riley@test.com'], role: 'ADMIN', requireTwoStep: true }]);
  await expect(page.getByRole('status').filter({ hasText: 'Invited 2 users.' })).toBeVisible();

  const casey = page.getByTestId('member-casey@test.com');
  await expect(casey.getByText('Pending')).toBeVisible();
  await expect(casey.getByText('Two-step required')).toBeVisible();

  await page.getByRole('button', { name: 'Pending' }).click();
  await expect(page.getByTestId('member-jordan@test.com')).toHaveCount(0);

  await casey.getByRole('button', { name: 'Resend invite to casey@test.com' }).click();
  await expect(page.getByText('Invite re-sent to casey@test.com.')).toBeVisible();
  expect(api.resent).toEqual(['new-casey@test.com']);
});

test('removes a user after confirmation, never yourself', async ({ page }) => {
  await mockSettingsApi(page);
  const api = await mockUsersApi(page);
  await page.goto('/admin/settings/users');

  const me = page.getByTestId('member-settings-admin@test.com');
  await expect(me.getByText('(you)')).toBeVisible();
  await expect(me.getByRole('button', { name: /Remove/ })).toHaveCount(0);
  await expect(me.getByLabel('Role for Sam Admin')).toBeDisabled();

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Remove Jordan Lee from this organization' }).click();
  await expect(page.getByText('Jordan Lee was removed.')).toBeVisible();
  expect(api.removed).toEqual(['user-1']);
  await expect(page.getByTestId('member-jordan@test.com')).toHaveCount(0);
});
