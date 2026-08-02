import { expect, type Page } from '@playwright/test';

export const openScenarioLab = async (page: Page): Promise<void> => {
  await page.goto('/');
  await expect(page.locator('#status')).toHaveAttribute('data-tessera-status', 'probe-passed');
};

export const openLab = async (page: Page, name: string): Promise<void> => {
  const tab = page.getByRole('button', { name, exact: true });
  await expect(tab).toHaveCount(1);
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
};

export const labPanel = (page: Page, panel: string) => page.locator(`[data-lab-panel="${panel}"]`);

export const bridgeIsPresent = async (page: Page): Promise<boolean> =>
  page.evaluate(() => window.tesseraTest !== undefined);
