// Two-step authentication (spec 030 C): the edge redirect for a pending
// session, the /auth/two-step page (trusted device, app code, recovery
// code, remember device), and the Security card (turn on wizard with
// recovery codes, regenerate, trusted devices, turn off).

import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mintSessionToken, signInAsStaff } from './helpers/session';

const API = 'http://localhost:3002';
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const USER = { id: 'user-ada', email: 'ada@example.com', role: 'ADMIN' as const, name: 'Ada Lovelace' };
const PROOF = 'proof.jwt.value';
const QR = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const CODES = ['aaaaa-bbbbb', 'ccccc-ddddd', 'eeeee-fffff', 'ggggg-hhhhh', 'jjjjj-kkkkk', 'mmmmm-nnnnn', 'ppppp-qqqqq', 'rrrrr-sssss', 'ttttt-uuuuu', 'vvvvv-wwwww'];

async function mockOrgAndSecurity(page: Page) {
  await page.route(`${API}/organizations`, (route) =>
    route.fulfill(json([{ id: 'org-1', name: 'Analytical Engines', status: 'ACTIVE', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }]))
  );
  await page.route(`${API}/account/sessions`, (route) => route.fulfill(json({ sessions: [] })));
  await page.route(`${API}/account/security`, (route) =>
    route.fulfill(json({ password: { set: false, updatedAt: null }, passkeys: [], providers: [], secondaryEmail: null, reauthMethods: ['email'] }))
  );
  // Step-up: the emailed-code path, always 123456
  await page.route(`${API}/account/reauth/start`, (route) => {
    const body = route.request().postDataJSON();
    return route.fulfill(json({ methods: ['email'], ...(body?.method === 'email' ? { sentTo: USER.email } : {}) }));
  });
  await page.route(`${API}/account/reauth`, (route) => route.fulfill(json({ reauthToken: 'proof-1', expiresAt: '2099-01-01T00:00:00.000Z' })));
}

async function completeReauth(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Confirm it’s you' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Send code' }).click();
  await dialog.getByLabel('Verification code').fill('123456');
  await dialog.getByRole('button', { name: 'Verify' }).click();
  await expect(dialog).toBeHidden();
}

/**
 * Pending session: the real Auth.js update() re-mints the cookie; here the
 * mocked POST /api/auth/session swaps the cookie for an `mfa: 'ok'` token
 * when it sees the proof.
 */
async function signInPending(page: Page, baseURL: string) {
  await signInAsStaff(page, { ...USER, mfa: 'pending' }, baseURL);
  const okToken = await mintSessionToken({ ...USER, mfa: 'ok' });
  const { hostname } = new URL(baseURL);
  const updates: unknown[] = [];
  await page.route('**/api/auth/session', async (route) => {
    const req = route.request();
    if (req.method() === 'POST') {
      const body = req.postDataJSON();
      updates.push(body?.data);
      if (body?.data?.mfaProof === PROOF) {
        await page.context().addCookies([{ name: 'authjs.session-token', value: okToken, domain: hostname, path: '/', httpOnly: true, sameSite: 'Lax' }]);
        return route.fulfill(json({ user: USER, accessToken: okToken, mfaPending: false, expires: '2099-01-01T00:00:00.000Z' }));
      }
    }
    const cookies = await page.context().cookies();
    const current = cookies.find((c) => c.name === 'authjs.session-token')?.value;
    const pending = current !== okToken;
    return route.fulfill(json({ user: USER, accessToken: current, mfaPending: pending, expires: '2099-01-01T00:00:00.000Z' }));
  });
  return { updates };
}

test.describe('Two-step: pending session', () => {
  test('the admin area redirects a pending session to /auth/two-step, keeping the destination', async ({ page, baseURL }) => {
    await signInPending(page, baseURL!);
    await mockOrgAndSecurity(page);
    await page.route('**/api/account/two-step/trusted-check', (route) => route.fulfill(json({ proof: null })));
    await page.goto('/admin/account?x=1');
    await expect(page).toHaveURL(/\/auth\/two-step\?callbackUrl=%2Fadmin%2Faccount%3Fx%3D1/);
    await expect(page.getByRole('heading', { name: 'Verify it’s you' })).toBeVisible();
    const results = await new AxeBuilder({ page }).include('main, form').analyze();
    expect(results.violations).toEqual([]);
  });

  test('an authenticator code completes the step and lands on the destination; the proof is redeemed through update()', async ({ page, baseURL }) => {
    const session = await signInPending(page, baseURL!);
    await mockOrgAndSecurity(page);
    await page.route('**/api/account/two-step/trusted-check', (route) => route.fulfill(json({ proof: null })));
    const verifies: unknown[] = [];
    await page.route(`${API}/account/two-step/verify`, (route) => {
      const body = route.request().postDataJSON();
      verifies.push(body);
      if (body.code === '654321') return route.fulfill(json({ proof: PROOF, method: 'app', ...(body.rememberDevice ? { trustToken: 'trust-token-abcdefghijklmnop' } : {}) }));
      return route.fulfill(json({ error: 'AuthenticationError', message: 'That code didn’t match.', code: 'CODE_INVALID' }, 401));
    });
    let trustCookieSet = false;
    await page.route('**/api/account/two-step/trust', (route) => {
      trustCookieSet = true;
      return route.fulfill(json({ ok: true }));
    });

    await page.goto('/auth/two-step?callbackUrl=%2Fadmin%2Faccount');
    await page.getByLabel('Authenticator code').fill('111111');
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page.getByRole('alert').first()).toContainText('didn’t match');
    await page.getByLabel('Remember this device for 30 days').check();
    await page.getByLabel('Authenticator code').fill('654321');
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page).toHaveURL(/\/admin\/account$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Account' })).toBeVisible();
    expect(verifies[1]).toEqual({ code: '654321', rememberDevice: true });
    expect(session.updates).toContainEqual({ mfaProof: PROOF });
    expect(trustCookieSet).toBe(true);
  });

  test('a recovery code works too', async ({ page, baseURL }) => {
    await signInPending(page, baseURL!);
    await mockOrgAndSecurity(page);
    await page.route('**/api/account/two-step/trusted-check', (route) => route.fulfill(json({ proof: null })));
    await page.route(`${API}/account/two-step/verify`, (route) => {
      const body = route.request().postDataJSON();
      return route.fulfill(body.recoveryCode === 'aaaaa-bbbbb' ? json({ proof: PROOF, method: 'recovery' }) : json({ message: 'no', code: 'CODE_INVALID' }, 401));
    });
    await page.goto('/auth/two-step');
    await page.getByRole('button', { name: 'Use a recovery code' }).click();
    await page.getByLabel('Recovery code').fill('aaaaa-bbbbb');
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page).toHaveURL(/\/admin\/dashboard/);
  });

  test('a trusted device completes silently', async ({ page, baseURL }) => {
    await signInPending(page, baseURL!);
    await mockOrgAndSecurity(page);
    await page.route('**/api/account/two-step/trusted-check', (route) => route.fulfill(json({ proof: PROOF })));
    await page.goto('/auth/two-step?callbackUrl=%2Fadmin%2Faccount%2Fsecurity');
    await expect(page).toHaveURL(/\/admin\/account\/security$/);
  });

  test('a session that is already complete skips the page', async ({ page, baseURL }) => {
    await signInAsStaff(page, { ...USER, mfa: 'ok' }, baseURL!);
    await mockOrgAndSecurity(page);
    await page.goto('/auth/two-step?callbackUrl=%2Fadmin%2Faccount');
    await expect(page).toHaveURL(/\/admin\/account$/);
  });
});

test.describe('Account › Security › Two-step card', () => {
  async function signInDone(page: Page, baseURL: string) {
    await signInAsStaff(page, USER, baseURL);
    await mockOrgAndSecurity(page);
    await page.route('**/api/auth/session', async (route) => {
      if (route.request().method() === 'POST') return route.fulfill(json({ user: USER, mfaPending: false, expires: '2099-01-01T00:00:00.000Z' }));
      return route.fallback();
    });
  }

  function mockTwoStep(page: Page, initial: { enabled: boolean }) {
    let status = initial.enabled
      ? { enabled: true, enabledAt: '2026-09-01T00:00:00.000Z', methods: { app: true, securityKey: false, passkeyCount: 0 }, recoveryCodes: { total: 10, remaining: 8 }, trustedDevices: [{ id: 'td-1', userAgent: 'Mozilla/5.0 (Macintosh) Chrome/128', createdAt: '2026-09-10T00:00:00.000Z', lastUsedAt: '2026-09-19T00:00:00.000Z', expiresAt: '2026-10-10T00:00:00.000Z' }], setupPending: false }
      : { enabled: false, enabledAt: null, methods: { app: false, securityKey: false, passkeyCount: 0 }, recoveryCodes: null, trustedDevices: [], setupPending: false };
    const calls: string[] = [];
    const reauthOk = (route: any) => route.request().headers()['x-jump-reauth'] === 'proof-1';
    const gate = (route: any, then: () => unknown, status_ = 200) => {
      calls.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
      if (!reauthOk(route)) return route.fulfill(json({ error: 'AuthenticationError', message: 'Confirm', code: 'REAUTH_REQUIRED' }, 401));
      const body = then();
      return body === undefined ? route.fulfill({ status: 204 }) : route.fulfill(json(body, status_));
    };
    return Promise.all([
      page.route(`${API}/account/two-step`, (route) => route.fulfill(json(status))),
      page.route(`${API}/account/two-step/setup`, (route) => gate(route, () => ({ otpauthUrl: 'otpauth://totp/Jump:ada@example.com?secret=ABCDEFGHIJKLMNOP', qrDataUrl: QR, secret: 'ABCDEFGHIJKLMNOP' }))),
      page.route(`${API}/account/two-step/enable`, (route) => {
        const body = route.request().postDataJSON();
        if (!reauthOk(route)) return route.fulfill(json({ code: 'REAUTH_REQUIRED', message: 'Confirm' }, 401));
        if (body.code !== '654321') return route.fulfill(json({ error: 'ValidationError', message: 'no', code: 'CODE_INVALID' }, 400));
        status = { ...status, enabled: true, enabledAt: '2026-09-20T00:00:00.000Z', methods: { app: true, securityKey: false, passkeyCount: 0 }, recoveryCodes: { total: 10, remaining: 10 } };
        return route.fulfill(json({ recoveryCodes: CODES, proof: PROOF, otherDevicesSignedOut: 1 }));
      }),
      page.route(`${API}/account/two-step/recovery-codes`, (route) => gate(route, () => ({ recoveryCodes: CODES }))),
      page.route(`${API}/account/two-step/disable`, (route) => {
        const body = route.request().postDataJSON();
        if (!reauthOk(route)) return route.fulfill(json({ code: 'REAUTH_REQUIRED', message: 'Confirm' }, 401));
        if (body.code !== '654321') return route.fulfill(json({ code: 'CODE_INVALID', message: 'no' }, 400));
        status = { enabled: false, enabledAt: null, methods: { app: false, securityKey: false, passkeyCount: 0 }, recoveryCodes: null, trustedDevices: [], setupPending: false };
        return route.fulfill({ status: 204 });
      }),
      page.route(`${API}/account/two-step/trusted-devices/*`, (route) => gate(route, () => { status = { ...status, trustedDevices: [] }; return undefined; })),
    ]).then(() => ({ calls, get: () => status }));
  }

  test('turn on: scan → code → recovery codes shown once', async ({ page, baseURL }) => {
    await signInDone(page, baseURL!);
    await mockTwoStep(page, { enabled: false });
    await page.goto('/admin/account/security');
    const card = page.getByTestId('two-step-card');
    await expect(card).toContainText('How it works');
    await card.getByRole('button', { name: 'Turn on' }).click();
    await completeReauth(page);
    const dialog = page.getByRole('dialog', { name: 'Turn on two-step authentication' });
    await expect(dialog.getByRole('img', { name: 'QR code for your authenticator app' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Can’t scan? Show setup key' }).click();
    await expect(dialog.getByTestId('totp-secret')).toHaveText('ABCDEFGHIJKLMNOP');
    await dialog.getByLabel('Code from your app').fill('111111');
    await dialog.getByRole('button', { name: 'Turn on' }).click();
    await expect(dialog.getByRole('alert')).toContainText('didn’t match');
    await dialog.getByLabel('Code from your app').fill('654321');
    await dialog.getByRole('button', { name: 'Turn on' }).click();
    const codesDialog = page.getByRole('dialog', { name: 'Save your recovery codes' });
    await expect(codesDialog.getByRole('list', { name: 'Recovery codes' })).toContainText('aaaaa-bbbbb');
    await expect(codesDialog.getByRole('button', { name: 'Done' })).toBeDisabled();
    await codesDialog.getByLabel("I've saved my recovery codes").check();
    await codesDialog.getByRole('button', { name: 'Done' }).click();
    await expect(codesDialog).toBeHidden();
    await expect(card).toContainText('On since');
    await expect(card.getByTestId('recovery-codes-remaining')).toHaveText('10 of 10 left.');
    await expect(page.getByRole('status').last()).toContainText('Two-step authentication is on; 1 other device signed out.');
  });

  test('when on: regenerate codes, remove a trusted device, turn off with a code', async ({ page, baseURL }) => {
    await signInDone(page, baseURL!);
    const mock = await mockTwoStep(page, { enabled: true });
    await page.goto('/admin/account/security');
    const card = page.getByTestId('two-step-card');
    await expect(card.getByTestId('recovery-codes-remaining')).toHaveText('8 of 10 left.');
    await expect(card.getByTestId('trusted-device-row')).toHaveCount(1);

    page.once('dialog', (d) => d.accept());
    await card.getByRole('button', { name: 'Generate new codes' }).click();
    await completeReauth(page);
    const codesDialog = page.getByRole('dialog', { name: 'Your new recovery codes' });
    await expect(codesDialog).toContainText('vvvvv-wwwww');
    await codesDialog.getByLabel("I've saved my recovery codes").check();
    await codesDialog.getByRole('button', { name: 'Done' }).click();
    await expect(codesDialog).toBeHidden();

    await card.getByRole('button', { name: 'Stop trusting this device' }).click();
    await expect(card.getByTestId('trusted-device-row')).toHaveCount(0);
    await expect(card).toContainText('Tick “Remember this device”');

    await card.getByRole('button', { name: 'Turn off' }).click();
    const off = page.getByRole('dialog', { name: 'Turn off two-step authentication' });
    await off.getByLabel('Authenticator or recovery code').fill('000000');
    await off.getByRole('button', { name: 'Turn off' }).click();
    await expect(off.getByRole('alert')).toContainText('didn’t match');
    await off.getByLabel('Authenticator or recovery code').fill('654321');
    await off.getByRole('button', { name: 'Turn off' }).click();
    await expect(off).toBeHidden();
    await expect(card).toContainText('How it works');
    expect(mock.calls.filter((c) => c.startsWith('DELETE'))).toHaveLength(1);
  });
});
