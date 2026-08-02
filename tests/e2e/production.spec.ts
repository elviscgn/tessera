import { expect, test } from '@playwright/test';

test.beforeEach(({ browserName }) => {
  test.skip(browserName !== 'chromium', 'Production smoke is gated by Chromium.');
});

test('production build keeps the development bridge absent', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#status')).toHaveAttribute('data-tessera-status', 'probe-passed');
  expect(await page.evaluate(() => window.tesseraTest === undefined)).toBe(true);
  await expect(page.locator('[data-lab-tab]')).toHaveCount(9);
});
