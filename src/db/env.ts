import { z } from 'zod';

/**
 * Server/worker-side environment (Node processes: capture workers, scripts,
 * integration tests, edge functions). The browser app is a later sprint and
 * will read its own `VITE_`-prefixed subset through `import.meta.env` rather
 * than this module — Vite only exposes `VITE_*` to client code, and the
 * service role key below must never reach a browser bundle.
 */
const envSchema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  /**
   * Bypasses RLS entirely (SPEC-data-model.md §9). Required for the capture
   * worker and for security-definer-adjacent scripts and tests that must set
   * up fixtures outside any one user's grant; never required, and never
   * present, in a browser context.
   */
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/**
 * Parses and validates `process.env` once per process. Throws with a
 * complete list of what's missing or malformed on first failure — never
 * returns a partially-valid config for a caller to null-check around.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Invalid or missing environment variables:\n${issues}\n\nSee .env.example for what's required.`,
    );
  }
  cached = result.data;
  return cached;
}

/** Test-only: clears the cache so a test can load a different environment. */
export function _resetEnvCacheForTests(): void {
  cached = undefined;
}
