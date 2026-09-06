import { defineConfig, devices } from '@playwright/test';

/**
 * UI/end-to-end smoke tests (CLAUDE.md's stack line, sprint DoD's
 * "Playwright smoke passes") plus the required landscape performance test
 * (e2e/landscape-perf.spec.ts, UI-principles §8.6, ADR-015). Needs a real
 * Supabase — `pnpm db:start` locally, or CI's `e2e` job — and the built app
 * served, per `webServer` below. Cannot run against a real Supabase in this
 * authoring sandbox (Docker Hub blocked, same limitation documented
 * throughout supabase/migrations and src/db/*.integration.test.ts); the
 * landscape-perf spec's payload-size assertion is the one part of that file
 * that needs neither a browser nor a database and was run directly here.
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
    // `--host 127.0.0.1`, not just `--port`: `vite preview`'s default host
    // is `localhost`, which some sandboxed/CI network namespaces resolve
    // to `::1` (IPv6) only — the `url` health check above probes
    // `127.0.0.1` specifically (IPv4), so a `localhost`-only bind can sit
    // there listening while this check never connects, timing out at
    // config.webServer's own 60s limit (Sprint H1 — this appears to be why
    // the `e2e` CI job has never once passed; see docs/AUDIT-2026-09-U2.md's
    // follow-up notes). Binding the same address the health check probes
    // removes the ambiguity either way.
    command: 'pnpm preview --port 5173 --host 127.0.0.1',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
  },
});
