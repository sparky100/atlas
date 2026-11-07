import { defineConfig } from 'vitest/config';

// Unit and property tests: no external services, safe to run anywhere,
// including in the lint/typecheck CI job's neighbours. Integration tests
// (against a local Supabase) live under vitest.integration.config.ts instead
// — they need a running database and are a separate CI job.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.property.test.ts', 'mcp/**/*.test.ts', 'scripts/**/*.test.ts'],
    exclude: ['src/**/*.integration.test.ts', 'mcp/**/*.integration.test.ts', 'node_modules/**'],
    environment: 'node',
    globals: false,
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.property.test.ts', 'src/**/*.integration.test.ts'],
    },
  },
});
