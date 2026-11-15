import { createClient } from '@supabase/supabase-js';
import { createDedupingFetch } from './dedupeFetch';
import { createLimitedFetch } from './limitedFetch';
import { loadBrowserEnv } from './env';

/**
 * The one browser-side Supabase client — anon key only, RLS applies in
 * full (src/db/client.ts's `createServiceRoleClient` must never be used
 * here). Created once at module load, not per-component; every hook and
 * repository call in src/ui shares this instance so there's exactly one
 * auth session and one realtime connection for the whole app.
 */
export const supabase = createClient(loadBrowserEnv().VITE_SUPABASE_URL, loadBrowserEnv().VITE_SUPABASE_ANON_KEY, {
  // Identical in-flight reads share one request (dedupeFetch.ts), and only a handful of reads run at once so a cold start doesn't open a dozen database connections together (limitedFetch.ts). Dedupe sits outside the cap so duplicates share one slot.
  global: { fetch: createDedupingFetch(createLimitedFetch((input, init) => fetch(input, init))) },
});
