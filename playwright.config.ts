import { defineConfig, devices } from '@playwright/test';

// Playwright config for the Space Empire SPA e2e suite (phase 8.9).
// Run: `npm i -D @playwright/test && npx playwright install chromium`, start
// the dev stack (back on :8080, `npm run dev` on :5173), then `npm run e2e`.
// Override the target with E2E_BASE_URL (e.g. a staging deploy).
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
