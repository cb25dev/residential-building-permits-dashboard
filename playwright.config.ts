import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  use: { baseURL: 'http://localhost:4173/', viewport: { width: 1440, height: 1000 }, ...devices['Desktop Chrome'] },
  webServer: { command: 'npm run preview', url: 'http://localhost:4173/', reuseExistingServer: true, timeout: 60_000 },
});
