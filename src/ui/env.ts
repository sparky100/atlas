import { z } from 'zod';

/**
 * Browser-side environment. Vite only exposes `VITE_`-prefixed variables to
 * client code (see src/db/env.ts's own note anticipating this file) — the
 * service-role key is never in this schema and never reaches a browser
 * bundle by construction, not just by convention.
 */
const browserEnvSchema = z.object({
  VITE_SUPABASE_URL: z.url(),
  VITE_SUPABASE_ANON_KEY: z.string().min(1),
});

export type BrowserEnv = z.infer<typeof browserEnvSchema>;

let cached: BrowserEnv | undefined;

export function loadBrowserEnv(source: ImportMetaEnv = import.meta.env): BrowserEnv {
  if (cached) return cached;
  const result = browserEnvSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`).join('\n');
    throw new Error(`Invalid or missing environment variables:\n${issues}\n\nSee .env.example for what's required.`);
  }
  cached = result.data;
  return cached;
}

/** Test-only: clears the cache so a test can load a different environment. */
export function _resetBrowserEnvCacheForTests(): void {
  cached = undefined;
}
