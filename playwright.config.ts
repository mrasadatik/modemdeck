import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: { baseURL: 'http://127.0.0.1:3100', ...devices['Desktop Chrome'] },
  webServer: {
    command: 'npm run build:all && node dist/server.js',
    url: 'http://127.0.0.1:3100/health',
    reuseExistingServer: false,
    timeout: 120_000,
    env: { PORT: '3100', MODEMDECK_PORT: '' },
  },
});
