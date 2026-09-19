// Legal versions mock for public forms (spec 024 phase 3): the apply and
// checkout pages fetch GET /legal/versions and echo them as `acceptances`.

import type { Page } from '@playwright/test';

export const LEGAL_VERSIONS = { terms: '2026-09-19-draft', privacy: '2026-09-19-draft', cardAuthorization: '2026-09-19-draft' };

export async function mockLegalVersions(page: Page, api: string) {
  await page.route(`${api}/legal/versions`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(LEGAL_VERSIONS) }));
}
