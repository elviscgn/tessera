import { expect, test } from '@playwright/test';
import { labPanel, openLab, openScenarioLab } from './helpers';

test('loads the Scenario Lab and can switch panels', async ({ page }) => {
  await openScenarioLab(page);
  await expect(page.locator('#status')).toContainText('probe-passed');
  await openLab(page, 'Camera');
  await expect(page.locator('#cameraRotation')).toHaveText('r0');
  await openLab(page, 'Boundary');
  await expect(labPanel(page, 'boundary').locator('h1')).toHaveText('Boundary laboratory');
});
