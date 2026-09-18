// Staff session for admin e2e tests.
//
// Since the edge middleware started enforcing /admin sign-in (PR #20), mocking
// GET /api/auth/session is not enough: the middleware decodes the Auth.js
// cookie itself. Mint the same HS256 token auth.config.ts produces and set it
// as the session cookie, then also mock the session endpoint for the client.

import { readFileSync } from 'fs';
import path from 'path';
import { SignJWT } from 'jose';
import type { Page } from '@playwright/test';

export interface StaffUser {
  id: string;
  email: string;
  role: 'ADMIN' | 'ORGANIZER' | 'SYSTEM_ADMIN' | 'UNASSIGNED';
  name?: string;
}

function authSecret(): string {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  const env = readFileSync(path.join(__dirname, '..', '..', '.env.local'), 'utf8');
  const match = env.match(/^AUTH_SECRET="?([^"\n]+)"?/m);
  if (!match) throw new Error('AUTH_SECRET not found in frontend/.env.local');
  return match[1];
}

export async function mintSessionToken(user: StaffUser): Promise<string> {
  return new SignJWT({ email: user.email, role: user.role, name: user.name ?? 'Test Staff', organizationId: null })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(authSecret()));
}

/** Sign the page in as staff: session cookie for the edge + mocked session endpoint for the client. */
export async function signInAsStaff(page: Page, user: StaffUser, baseURL: string) {
  const token = await mintSessionToken(user);
  const { hostname } = new URL(baseURL);
  await page.context().addCookies([{ name: 'authjs.session-token', value: token, domain: hostname, path: '/', httpOnly: true, sameSite: 'Lax' }]);
  await page.route('**/api/auth/session', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user: { id: user.id, email: user.email, role: user.role }, accessToken: token, expires: '2099-01-01T00:00:00.000Z' }),
    })
  );
  return token;
}
