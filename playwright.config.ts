import { defineConfig, devices } from '@playwright/test';

/**
 * UI/end-to-end smoke tests (CLAUDE.md's stack line, sprint DoD's
 * "Playwright smoke passes"). Needs a real Supabase — `pnpm db:start`
 * locally, or CI's `e2e` job — and the built app served, per `webServer`
 * below. Cannot run in this authoring sandbox (Docker Hub blocked, same
 * limitation documented throughout supabase/migrations and
 * src/db/*.integration.test.ts).
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm preview --port 5173',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
  },
});
