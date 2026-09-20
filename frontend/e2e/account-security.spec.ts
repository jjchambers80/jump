// Account › Security sign-in methods (spec 030 B): step-up dialog on a
// 401 REAUTH_REQUIRED, password add, passkey registration through the
// browser ceremony (virtual authenticator), Google disconnect, secondary
// email, sign-in page password/passkey/recover entry points.

import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { signInAsStaff } from './helpers/session';

const API = 'http://localhost:3002';
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const REAUTH_401 = json({ error: 'AuthenticationError', message: 'Confirm it’s you', code: 'REAUTH_REQUIRED' }, 401);

const baseOverview = {
  password: { set: false, updatedAt: null as string | null },
  passkeys: [] as { id: string; label: string; deviceType: string; backedUp: boolean; transports: string[]; createdAt: string; lastUsedAt: string | null }[],
  providers: [{ provider: 'google', accountIdHint: '…3456', connectedAt: '2026-01-01T00:00:00.000Z' }],
  secondaryEmail: null as null | { email: string; verified: boolean },
  reauthMethods: ['email'] as string[],
};

async function signIn(page: Page, baseURL: string) {
  await signInAsStaff(page, { id: 'user-ada', email: 'ada@example.com', role: 'ADMIN', name: 'Ada Lovelace' }, baseURL);
  await page.route(`${API}/organizations`, (route) =>
    route.fulfill(json([{ id: 'org-1', name: 'Analytical Engines', status: 'ACTIVE', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }]))
  );
  await page.route(`${API}/account/sessions`, (route) => route.fulfill(json({ sessions: [] })));
}

/** Stateful security stub: mutations need X-Jump-Reauth: proof-1 or they 401. */
async function mockSecurity(page: Page, initial: Partial<typeof baseOverview> = {}) {
  let overview = { ...baseOverview, ...initial };
  const calls: { path: string; method: string; reauth: string | null; body?: any }[] = [];
  const record = (route: any) => {
    const req = route.request();
    const entry = { path: new URL(req.url()).pathname, method: req.method(), reauth: req.headers()['x-jump-reauth'] ?? null, body: req.postDataJSON?.() };
    calls.push(entry);
    return entry;
  };
  const gated = (route: any, then: (entry: any) => unknown) => {
    const entry = record(route);
    if (entry.reauth !== 'proof-1') return route.fulfill(REAUTH_401);
    return route.fulfill(json(then(entry) ?? {}));
  };

  await page.route(`${API}/account/security`, (route) => route.fulfill(json(overview)));
  await page.route(`${API}/account/reauth/start`, (route) => {
    const body = route.request().postDataJSON();
    record(route);
    return route.fulfill(json({ methods: overview.reauthMethods, ...(body?.method === 'email' ? { sentTo: 'ada@example.com' } : {}) }));
  });
  await page.route(`${API}/account/reauth`, (route) => {
    const body = route.request().postDataJSON();
    record(route);
    if (body?.code === '123456') return route.fulfill(json({ reauthToken: 'proof-1', expiresAt: '2099-01-01T00:00:00.000Z' }));
    return route.fulfill(json({ error: 'AuthenticationError', message: 'That code is wrong or expired', code: 'REAUTH_FAILED' }, 401));
  });
  await page.route(`${API}/account/password`, (route) =>
    gated(route, () => {
      if (route.request().method() === 'DELETE') {
        overview = { ...overview, password: { set: false, updatedAt: null } };
        return { set: false };
      }
      overview = { ...overview, password: { set: true, updatedAt: '2026-09-20T12:00:00.000Z' }, reauthMethods: ['password', 'email'] };
      return { set: true, updatedAt: '2026-09-20T12:00:00.000Z', otherDevicesSignedOut: 2 };
    })
  );
  await page.route(`${API}/account/providers/google`, (route) =>
    gated(route, () => {
      overview = { ...overview, providers: [] };
    })
  );
  await page.route(`${API}/account/secondary-email`, (route) =>
    gated(route, (entry) => {
      if (entry.method === 'DELETE') {
        overview = { ...overview, secondaryEmail: null };
        return {};
      }
      overview = { ...overview, secondaryEmail: { email: entry.body.email, verified: false } };
      return overview.secondaryEmail;
    })
  );
  await page.route(`${API}/account/secondary-email/resend`, (route) => { record(route); return route.fulfill({ status: 204 }); });
  await page.route(`${API}/account/passkeys/register/options`, (route) =>
    gated(route, () => ({
      rp: { name: 'Jump', id: 'localhost' },
      user: { id: 'dXNlci1hZGE', name: 'ada@example.com', displayName: 'Ada Lovelace' },
      challenge: 'Y2hhbGxlbmdlLWNoYWxsZW5nZS1jaGFsbGVuZ2U',
      pubKeyCredParams: [{ alg: -7, type: 'public-key' }, { alg: -257, type: 'public-key' }],
      timeout: 60000,
      attestation: 'none',
      excludeCredentials: [],
      authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'preferred' },
    }))
  );
  await page.route(`${API}/account/passkeys/register/verify`, (route) =>
    gated(route, (entry) => {
      const passkey = { id: 'pk-1', label: 'macOS · Chrome', deviceType: 'multiDevice', backedUp: true, transports: ['internal'], createdAt: '2026-09-20T12:00:00.000Z', lastUsedAt: null };
      overview = { ...overview, passkeys: [passkey], reauthMethods: ['passkey', 'email'] };
      expect(entry.body.response.id).toBeTruthy();
      return passkey;
    })
  );
  await page.route(`${API}/account/passkeys/*`, (route) => {
    if (route.request().method() === 'PATCH') {
      const entry = record(route);
      overview = { ...overview, passkeys: overview.passkeys.map((p) => ({ ...p, label: entry.body.label })) };
      return route.fulfill(json(overview.passkeys[0]));
    }
    return gated(route, () => {
      overview = { ...overview, passkeys: [], reauthMethods: ['email'] };
    });
  });
  return { calls, get: () => overview };
}

/** Drive the "Confirm it's you" dialog with the emailed code. */
async function completeReauth(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Confirm it’s you' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Send code' }).click();
  await expect(dialog.getByText('We emailed a 6-digit code')).toBeVisible();
  await dialog.getByLabel('Verification code').fill('000000');
  await dialog.getByRole('button', { name: 'Verify' }).click();
  await expect(dialog.getByRole('alert')).toContainText('wrong or expired');
  await dialog.getByLabel('Verification code').fill('123456');
  await dialog.getByRole('button', { name: 'Verify' }).click();
  await expect(dialog).toBeHidden();
}

test.describe('Account › Security › sign-in methods', () => {
  test('renders the cards from the overview', async ({ page, baseURL }) => {
    await signIn(page, baseURL!);
    await mockSecurity(page);
    await page.goto('/admin/account/security');
    await expect(page.getByTestId('passkeys-card')).toContainText('No passkeys yet');
    await expect(page.getByTestId('password-card')).toContainText('No password');
    await expect(page.getByTestId('connected-accounts-card')).toContainText('Connected (…3456)');
    await expect(page.getByTestId('secondary-email-card')).toContainText('restore access to your account');
    await expect(page.getByRole('button', { name: 'Add secondary email' })).toBeVisible();
    const results = await new AxeBuilder({ page }).include('main').analyze();
    expect(results.violations).toEqual([]);
  });

  test('adding a password asks to confirm identity, then retries with the proof', async ({ page, baseURL }) => {
    await signIn(page, baseURL!);
    const mock = await mockSecurity(page);
    await page.goto('/admin/account/security');
    await page.getByRole('button', { name: 'Add password' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add password' });
    await dialog.getByLabel('New password').fill('short');
    await dialog.getByLabel('Confirm password').fill('short');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog.getByText('Use at least 12 characters.')).toBeVisible();
    await dialog.getByLabel('New password').fill('a long and fine passphrase');
    await dialog.getByLabel('Confirm password').fill('a long and fine passphrase');
    await dialog.getByRole('button', { name: 'Save' }).click();

    await completeReauth(page);

    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('password-card')).toContainText('Last changed');
    await expect(page.getByRole('status').last()).toHaveText('Password added; 2 other devices signed out.');
    const passwordCalls = mock.calls.filter((c) => c.path === '/account/password');
    expect(passwordCalls.map((c) => c.reauth)).toEqual([null, 'proof-1']);

    // The proof is remembered: removing the password does not ask again
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByTestId('password-card')).toContainText('No password');
    expect(mock.calls.filter((c) => c.path === '/account/password' && c.method === 'DELETE')[0].reauth).toBe('proof-1');
  });

  test('registers a passkey through the browser ceremony', async ({ page, baseURL }) => {
    await signIn(page, baseURL!);
    await mockSecurity(page);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
    });
    await page.goto('/admin/account/security');
    await page.getByRole('button', { name: 'Add passkey' }).click();
    await completeReauth(page);
    await expect(page.getByTestId('passkey-row')).toHaveCount(1);
    await expect(page.getByTestId('passkey-row')).toContainText('macOS · Chrome');
    await expect(page.getByRole('status').last()).toHaveText('Passkey "macOS · Chrome" added.');

    await page.getByRole('button', { name: 'Rename passkey macOS · Chrome' }).click();
    await page.getByLabel('Passkey name').fill('Work laptop');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByTestId('passkey-row')).toContainText('Work laptop');

    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Remove passkey Work laptop' }).click();
    await expect(page.getByTestId('passkeys-card')).toContainText('No passkeys yet');
  });

  test('disconnects Google after confirmation and shows Connect afterwards', async ({ page, baseURL }) => {
    await signIn(page, baseURL!);
    const mock = await mockSecurity(page);
    await page.goto('/admin/account/security');
    page.once('dialog', (d) => {
      expect(d.message()).toContain('Disconnect Google?');
      d.accept();
    });
    await page.getByRole('button', { name: 'Disconnect' }).click();
    await completeReauth(page);
    await expect(page.getByRole('button', { name: 'Connect Google' })).toBeVisible();
    expect(mock.calls.filter((c) => c.path === '/account/providers/google').map((c) => c.reauth)).toEqual([null, 'proof-1']);
  });

  test('secondary email goes pending with resend, then can be removed', async ({ page, baseURL }) => {
    await signIn(page, baseURL!);
    const mock = await mockSecurity(page);
    await page.goto('/admin/account/security');
    await page.getByRole('button', { name: 'Add secondary email' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add secondary email' });
    await dialog.getByLabel('Secondary email').fill('ada@example.com');
    await dialog.getByRole('button', { name: 'Send verification' }).click();
    await expect(dialog.getByText('already your primary email')).toBeVisible();
    await dialog.getByLabel('Secondary email').fill('backup@example.com');
    await dialog.getByRole('button', { name: 'Send verification' }).click();
    await completeReauth(page);
    await expect(dialog).toBeHidden();
    const card = page.getByTestId('secondary-email-card');
    await expect(card).toContainText('backup@example.com');
    await expect(card).toContainText('Not verified yet');
    await card.getByRole('button', { name: 'Resend' }).click();
    await expect(page.getByRole('status').last()).toHaveText('Verification email sent again.');
    page.once('dialog', (d) => d.accept());
    await card.getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByRole('button', { name: 'Add secondary email' })).toBeVisible();
    expect(mock.calls.some((c) => c.path === '/account/secondary-email/resend')).toBe(true);
  });

  test('cancelling the identity check leaves the form open and nothing changed', async ({ page, baseURL }) => {
    await signIn(page, baseURL!);
    const mock = await mockSecurity(page);
    await page.goto('/admin/account/security');
    await page.getByRole('button', { name: 'Add password' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add password' });
    await dialog.getByLabel('New password').fill('a long and fine passphrase');
    await dialog.getByLabel('Confirm password').fill('a long and fine passphrase');
    await dialog.getByRole('button', { name: 'Save' }).click();
    const reauth = page.getByRole('dialog', { name: 'Confirm it’s you' });
    await expect(reauth).toBeVisible();
    await reauth.getByRole('button', { name: 'Cancel' }).click();
    await expect(reauth).toBeHidden();
    await expect(dialog).toBeVisible();
    expect(mock.calls.filter((c) => c.path === '/account/password')).toHaveLength(1);
  });
});

test.describe('Sign-in page entry points', () => {
  test('offers passkey, password and recovery', async ({ page }) => {
    await page.goto('/auth/signin');
    await expect(page.getByTestId('signin-passkey')).toBeVisible();
    await page.getByRole('button', { name: 'Sign in with a password instead' }).click();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in with password' })).toBeDisabled();
    await page.getByLabel('Email address').fill('ada@example.com');
    await page.getByLabel('Password').fill('something');
    await expect(page.getByRole('button', { name: 'Sign in with password' })).toBeEnabled();
    await page.getByRole('link', { name: 'Restore access with your secondary email' }).click();
    await expect(page).toHaveURL(/\/auth\/recover$/);
    await page.route(`${API}/auth/recover`, (route) => route.fulfill(json({ ok: true })));
    await page.getByLabel('Secondary email').fill('backup@example.com');
    await page.getByRole('button', { name: 'Send sign-in link' }).click();
    await expect(page.getByRole('status')).toContainText("we've sent it a sign-in link");
  });

  test('a secondary-email confirmation link lands on a result page', async ({ page }) => {
    await page.route(`${API}/account/secondary-email/confirm`, (route) => route.fulfill(json({ email: 'backup@example.com' })));
    await page.goto('/auth/confirm-secondary-email?token=abcdefghijklmnopqrstuvwxyz');
    await expect(page.getByRole('heading', { name: 'Secondary email verified' })).toBeVisible();
    await page.route(`${API}/account/secondary-email/confirm`, (route) => route.fulfill(json({ error: 'ValidationError', message: 'This link has expired.', code: 'TOKEN_EXPIRED' }, 400)));
    await page.goto('/auth/confirm-secondary-email?token=abcdefghijklmnopqrstuvwxyz');
    await expect(page.getByRole('heading', { name: 'This link has expired' })).toBeVisible();
  });
});
