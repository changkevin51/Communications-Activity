import { defineConfig, devices } from '@playwright/test';

const PORT = 3222;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 180_000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
    { name: 'mobile-webkit', use: { ...devices['iPhone 13'] } },
  ],
  webServer: {
    command: 'node tests/e2e/serve.mjs',
    url: `http://127.0.0.1:${PORT}/healthz`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { PORT: String(PORT), HOST: '127.0.0.1', ADMIN_KEY: 'e2e-key' },
  },
});
