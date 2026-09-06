import { createClient } from '@supabase/supabase-js';
import { loadBrowserEnv } from './env';

/**
 * The one browser-side Supabase client — anon key only, RLS applies in
 * full (src/db/client.ts's `createServiceRoleClient` must never be used
 * here). Created once at module load, not per-component; every hook and
 * repository call in src/ui shares this instance so there's exactly one
 * auth session and one realtime connection for the whole app.
 */
export const supabase = createClient(loadBrowserEnv().VITE_SUPABASE_URL, loadBrowserEnv().VITE_SUPABASE_ANON_KEY);
