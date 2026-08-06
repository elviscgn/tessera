import { expect, test } from '@playwright/test';
import { bridgeIsPresent, labPanel, openLab, openScenarioLab } from './helpers';

test.beforeEach(async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Complete flows are gated by Chromium.');
  await openScenarioLab(page);
});

test('starts with a ready Worker and structured boundary state', async ({ page }) => {
  await expect(page.locator('#telemetry')).toHaveAttribute('data-tessera-simulation-tick', '1');
  await expect(page.locator('#telemetry')).toHaveAttribute('data-tessera-render-tick', '1');
  expect(await bridgeIsPresent(page)).toBe(true);
  expect(await page.locator('[data-lab-tab]').count()).toBe(9);
});

test('drives camera, footprint preview, selection, and placement controls', async ({ page }) => {
  await openLab(page, 'Placement');
  await page.getByRole('combobox', { name: 'Object type', exact: true }).selectOption('warehouse');
  await expect(page.locator('#placementFootprint')).toHaveText('4 cells');

  const canvas = page.locator('#renderCanvas');
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  if (bounds === null) {
    return;
  }
  await page.mouse.move(bounds.x + 96, bounds.y + 180);
  await expect(page.locator('#placementStatus')).not.toHaveText('move over a cell');
  await labPanel(page, 'placement')
    .getByRole('button', { name: 'Rotate right', exact: true })
    .click();
  await expect(page.locator('#placementRotation')).toHaveText('r1');

  const placementMode = labPanel(page, 'placement').locator('[data-placement-action="place"]');
  await placementMode.click();
  await expect(placementMode).toHaveAttribute('aria-pressed', 'true');
  await expect(placementMode).toHaveText('Cancel placement');
  await page.mouse.click(bounds.x + 96, bounds.y + 180);
  await expect(placementMode).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-testid="placement-result"]')).toContainText(
    'Placed warehouse at',
  );
  await page.mouse.click(bounds.x + 96, bounds.y + 250);
  await expect(placementMode).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-testid="placement-result"]')).toContainText(
    'Placed warehouse at',
  );
  await placementMode.click();
  await expect(placementMode).toHaveAttribute('aria-pressed', 'false');

  await openLab(page, 'Camera');
  await labPanel(page, 'camera').getByRole('button', { name: 'Rotate right', exact: true }).click();
  await expect(page.locator('#cameraRotation')).toHaveText('r1');
});

test('runs renderer stress and boundary metrics without changing the lab contract', async ({
  page,
}) => {
  await openLab(page, 'Entity stress');
  await page.getByRole('button', { name: 'Populate field', exact: true }).click();
  await expect(page.locator('#stressResult')).toContainText('12 entities submitted');
  await expect(page.locator('#stressEntityCount')).toHaveText('12');
  await expect(page.locator('#stressGroupCount')).toHaveText('3');

  await openLab(page, 'Simulation stress');
  await page.getByRole('button', { name: 'Pause clock', exact: true }).click();
  await page.getByRole('button', { name: 'Run exact ticks', exact: true }).click();
  await expect(page.locator('#simulationResult')).toContainText('Checkpoint tick');

  await openLab(page, 'Boundary');
  await page.getByRole('button', { name: 'Refresh metrics', exact: true }).click();
  await expect(page.locator('#boundaryResult')).toContainText('memory generation');
  await expect(page.locator('#metricViewRecreations')).not.toHaveText('—');
});

test('preserves the active world on a failed save import and reports errors', async ({ page }) => {
  await openLab(page, 'Persistence');
  await page.getByRole('button', { name: 'Save current', exact: true }).click();
  await expect(page.locator('#saveBytes')).not.toHaveText('—');
  await page.getByRole('button', { name: 'Corrupt import', exact: true }).click();
  await expect(page.locator('[data-testid="persistence-result"]')).toContainText(
    'active world preserved: yes',
  );

  await openLab(page, 'Errors');
  await page.getByRole('button', { name: 'Invalid placement', exact: true }).click();
  await expect(page.locator('[data-testid="error-result"]')).toContainText(
    'active world preserved: yes',
  );

  await openLab(page, 'Lifecycle');
  await page.getByRole('button', { name: 'Run reset cycles', exact: true }).click();
  await expect(page.locator('#lifecycleResult')).toContainText('reset cycles complete');
  await expect(page.locator('#lifecycleWorldGeneration')).not.toHaveText('0');
});
