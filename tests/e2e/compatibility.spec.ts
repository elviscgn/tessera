import { expect, test } from '@playwright/test';
import { labPanel, openLab } from './helpers';

test('loads the Scenario Lab and can switch panels', async ({ page }, testInfo) => {
  await page.goto('/');
  const status = page.locator('#status');
  await expect(status).toHaveAttribute('data-tessera-status', /^(probe-passed|fatal)$/u);
  const statusValue = await status.getAttribute('data-tessera-status');
  if (statusValue === 'fatal') {
    expect(testInfo.project.name).toBe('firefox');
    await expect(status).toHaveAttribute('data-tessera-error-code', 'webgl_unavailable');
    await expect(page.getByRole('button', { name: 'Camera', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Boundary', exact: true })).toBeVisible();
    return;
  }
  await expect(status).toContainText('probe-passed');
  await openLab(page, 'Camera');
  await expect(page.locator('#cameraRotation')).toHaveText('r0');
  await openLab(page, 'Boundary');
  await expect(labPanel(page, 'boundary').locator('h1')).toHaveText('Boundary laboratory');
});
