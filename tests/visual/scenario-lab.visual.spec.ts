import { expect, test } from '@playwright/test';
import { openLab, openScenarioLab } from '../e2e/helpers';

test.beforeEach(async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Canonical visuals are gated by Chromium.');
  await openScenarioLab(page);
});

test('captures the fixed visual museum scene', async ({ page }) => {
  await openLab(page, 'Visual museum');
  await page.getByRole('button', { name: 'Load museum scene', exact: true }).click();
  await expect(page.locator('#museumResult')).toContainText('Museum scene ready');
  await page.addStyleTag({
    content:
      '#status, #telemetry, #museumWorldGeneration, #museumSnapshotGeneration, #museumRenderFrames, #museumResetCount, #museumResult { visibility: hidden !important; }',
  });
  await expect(page).toHaveScreenshot('scenario-lab-museum.png', {
    animations: 'disabled',
  });
});

test('exports a reproduction manifest from the museum controls', async ({ page }) => {
  await openLab(page, 'Visual museum');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download reproduction manifest', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('tessera-scenario-lab-reproduction.json');
});
