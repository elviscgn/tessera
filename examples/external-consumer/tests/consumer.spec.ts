import { expect, test } from '@playwright/test';

test('uses only the packed public runtime and completes the consumer flow', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('runtime-status')).toHaveAttribute('data-tessera-status', 'ready');
  await expect(page.getByTestId('runtime-status')).toContainText('saved, removed, restored');
  await expect(page.locator('#saveBytes')).not.toHaveText('—');
  await expect(page.locator('#restoredHash')).toHaveText(/^[0-9a-f]{64}$/u);
  await expect(page.locator('#replayCommands')).toHaveText('1');
  await expect(page.locator('#testBridge')).toHaveText('available');
});
