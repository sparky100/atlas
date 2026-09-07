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

-- TEMPORARY (same cleanup as above): debug_whoami() proved auth.uid() and
-- role are correct for an RPC call on this exact session, yet the same
-- session's plain `.from('organisations').insert(...)` still hits
-- organisations_insert's RLS check. This performs the identical insert
-- from inside a security-invoker function instead of via PostgREST's own
-- generated INSERT, to see whether the check behaves differently through
-- this path, and to capture the raw exception if not.
create or replace function public.debug_try_insert_org(p_id uuid, p_name text, p_slug text, p_created_by uuid)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_row organisations;
begin
  insert into organisations (id, name, slug, created_by) values (p_id, p_name, p_slug, p_created_by) returning * into v_row;
  return jsonb_build_object('ok', true, 'auth_uid_at_insert', auth.uid(), 'row_created_by', v_row.created_by);
exception when others then
  return jsonb_build_object('ok', false, 'sqlstate', sqlstate, 'message', sqlerrm, 'auth_uid_at_insert', auth.uid(), 'p_created_by', p_created_by);
end;
$$;

grant execute on function public.debug_try_insert_org(uuid, text, text, uuid) to authenticated;
