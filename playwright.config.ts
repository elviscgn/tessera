import { defineConfig, devices } from '@playwright/test';

const production = process.env.TESSERA_E2E_MODE === 'production';
const configuredBaseUrl = process.env.TESSERA_BASE_URL;
const port = production ? 4174 : 5173;
const baseURL = configuredBaseUrl ?? `http://127.0.0.1:${port}`;
const snapshotPlatform = process.platform === 'darwin' ? 'darwin' : 'linux';

const fixedBrowserOptions = {
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 1,
  colorScheme: 'dark' as const,
  locale: 'en-US',
  timezoneId: 'UTC',
};

export default defineConfig({
  testDir: 'tests',
  testMatch: /.*\.spec\.ts/u,
  outputDir: 'test-results/playwright',
  snapshotDir: 'tests/visual',
  snapshotPathTemplate: `{snapshotDir}/{testFilePath}-snapshots/${snapshotPlatform}/{arg}{ext}`,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'list',
  expect: {
    timeout: 15_000,
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      maxDiffPixelRatio: 0.02,
    },
  },
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
    ...fixedBrowserOptions,
  },
  ...(configuredBaseUrl
    ? {}
    : {
        webServer: {
          command: production
            ? `pnpm build && pnpm exec vite preview --host 127.0.0.1 --port ${port}`
            : `pnpm dev --host 127.0.0.1 --port ${port}`,
          url: baseURL,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      }),
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...fixedBrowserOptions,
        launchOptions: {
          args: ['--disable-gpu', '--force-device-scale-factor=1'],
        },
      },
    },
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        ...fixedBrowserOptions,
        launchOptions: {
          firefoxUserPrefs: {
            'webgl.disabled': false,
            'webgl.force-enabled': true,
            'dom.webgl2.enabled': true,
            'layers.acceleration.force-enabled': true,
            'gfx.webrender.all': true,
          },
        },
      },
    },
    {
      name: 'webkit',
      use: {
        ...devices['Desktop Safari'],
        ...fixedBrowserOptions,
      },
    },
  ],
});
