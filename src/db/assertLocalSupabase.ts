/**
 * Test-run guard. Integration and Playwright runs create organisations and
 * users with the service-role key, so they must only ever talk to a local
 * Supabase. On 2026-11-17 an integration run with the live project's
 * SUPABASE_URL and service-role key still set in the shell created 56 test
 * organisations and 190 test users in production. There is deliberately no
 * override: to test against anything else, change this file in a reviewed PR.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', 'host.docker.internal']);

export function assertLocalSupabaseUrl(name: string, value: string | undefined): void {
  if (value === undefined || value === '') return;
  let host: string;
  try {
    host = new URL(value).hostname;
  } catch {
    throw new Error(`Refusing to run tests: ${name} is not a valid URL.`);
  }
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `Refusing to run tests: ${name} points at "${host}", not a local Supabase. ` +
        'Tests create and change real data with the service-role key. ' +
        'Run `pnpm db:start`, then clear SUPABASE_* and VITE_SUPABASE_* from this shell (or copy .env.example).',
    );
  }
}

/** Checks every Supabase URL a test run can read; throws on the first non-local one. */
export function assertLocalTestEnvironment(env: NodeJS.ProcessEnv = process.env): void {
  assertLocalSupabaseUrl('SUPABASE_URL', env.SUPABASE_URL);
  assertLocalSupabaseUrl('VITE_SUPABASE_URL', env.VITE_SUPABASE_URL);
}
