-- TEMPORARY (Sprint C1-H item 1 diagnostic — DELETE this migration once the
-- organisations RLS failure is root-caused, before the sprint is called
-- done; never meant to ship). The client-side JWT decode already proved
-- sub/role/exp/aud are all correct and getSession() agrees with the token
-- signInWithPassword returned (docs/AUDIT-2026-09-C1.md §1.4 addendum) — so
-- this checks the other half: what Postgres itself sees for the same
-- request, which a client-side decode can never observe (a verification
-- failure at PostgREST would leave the client none the wiser). Lives in
-- `public` (unlike everything else this repo puts under `atlas`) purely so
-- PostgREST — which only exposes `public`/`graphql_public`
-- (supabase/config.toml's `[api] schemas`) — can reach it via `.rpc()`.

create or replace function public.debug_whoami()
returns jsonb
language sql stable security invoker
as $$
  select jsonb_build_object(
    'auth_uid', auth.uid(),
    'auth_role', auth.role(),
    'current_user', current_user,
    'session_user', session_user,
    'jwt_claims', current_setting('request.jwt.claims', true),
    'jwt_claim_role', current_setting('request.jwt.claim.role', true)
  );
$$;

grant execute on function public.debug_whoami() to authenticated;
