import { defineConfig } from 'vitest/config';

// Integration tests against a local Supabase (CLAUDE.md src/db layer, SPEC §9
// RLS). Requires `pnpm db:start` first (or the CI "database" job, which starts
// it automatically). Kept out of the default `pnpm test` run so unit/property
// tests stay fast and dependency-free.
export default defineConfig({
  test: {
    include: ['src/**/*.integration.test.ts'],
    environment: 'node',
    globals: false,
    passWithNoTests: true,
    // Integration tests share one Postgres instance and reset their own
    // fixtures per test; running them one file at a time avoids cross-test
    // interference until the fixture story (per-test schema or transaction
    // rollback) is decided in src/db.
    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
