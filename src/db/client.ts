/**
 * Supabase client factories. Two, matching SPEC-data-model.md §9's two
 * roles: the anon-key client every authenticated user's session uses
 * (RLS applies in full), and the service-role client for the narrow set of
 * things RLS deliberately has no policy for at all (the capture worker,
 * integration-test fixture setup — SPEC §3.6, §9). Never use the
 * service-role client on a request path a real user's session drives.
 */
import { createClient } from '@supabase/supabase-js';
import type { Env } from './env';

export function createSupabaseClient(env: Env) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
}

export function createServiceRoleClient(env: Env) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('createServiceRoleClient: SUPABASE_SERVICE_ROLE_KEY is not set in this environment');
  }
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** The type every repository function takes — inferred from the factories above rather than named against `@supabase/supabase-js` directly, which sidesteps a generic-arity mismatch between that package's own default type parameters and an explicitly-written `SupabaseClient` annotation. */
export type Client = ReturnType<typeof createSupabaseClient>;
