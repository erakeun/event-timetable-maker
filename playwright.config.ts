import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const installedChromium = join(homedir(), 'Library', 'Caches', 'ms-playwright', 'chromium-1187', 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium');
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync(installedChromium) ? installedChromium : undefined);
export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.e2e.ts',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  workers: 1,
  fullyParallel: false,
  outputDir: './work/playwright-results',
  reporter: [['list'], ['json', { outputFile: './work/playwright-report.json' }]],
  use: {
    baseURL: process.env.PUBLIC_BASE_URL || 'http://127.0.0.1:4173/',
    browserName: 'chromium',
    headless: true,
    actionTimeout: 15_000,
    viewport: { width: 1440, height: 1000 },
    launchOptions: executablePath ? { executablePath } : {},
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: process.env.PUBLIC_BASE_URL ? undefined : {
    command: 'npm run build && npm run preview -- --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
