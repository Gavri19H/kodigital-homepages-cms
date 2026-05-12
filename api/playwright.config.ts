import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './test-ui',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:8787',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:8787',
    port: 8787,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      DEV_BYPASS_AUTH: 'true',
    },
  },
});
