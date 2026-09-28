import { test, expect } from '@playwright/test';

for (const org of ['org-dark', 'org-system', 'org-public']) {
  test(`no hydration warnings on ${org}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text());
    });
    await page.goto(`/spike/storefront/${org}`);
    await page.waitForLoadState('networkidle');
    expect(errors.filter((e) => /hydrat|did not match/i.test(e))).toEqual([]);
  });
}
