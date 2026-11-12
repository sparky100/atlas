-- Map speed, option B (docs/perf): wrap every bare `auth.uid()` / `auth.jwt()` /
-- `auth.role()` / `auth.email()` call inside a row-level-security policy as
-- `(select auth.<fn>())`.
--
-- Why: Postgres re-runs a bare `auth.uid()` for every row a policy checks,
-- but evaluates `(select auth.uid())` once per query (an "initplan").
-- Supabase's performance advisor (`auth_rls_initplan`) flags 53 policies in
-- the live project for this. It changes only how often the call runs, never
-- its value, so who can see or write what is identical.
--
-- Written as a rewrite over `pg_policies` rather than 53 hand-copied
-- `alter policy` statements, so it picks up each policy's *current*
-- definition (several were redefined by later migrations) and cannot
-- silently revert one to an older text. Idempotent: a call already preceded
-- by `SELECT ` (the deparsed form of a wrapped call) is left alone, so a
-- second run changes nothing.
--
-- Scope: the `public` and `atlas` schemas only. `storage.objects`' policies
-- belong to Supabase's storage role and contain no bare `auth.*()` call.
-- This does NOT touch the helpers (`atlas.is_member`, `atlas.has_role`);
-- those are function calls with a per-row argument and are the separate,
-- security-sensitive option C.

do $$
declare
  p record;
  new_qual text;
  new_check text;
  stmt text;
begin
  for p in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname in ('public', 'atlas')
      and (qual ~ '(?<!SELECT )auth\.(uid|jwt|role|email)\(\)' or with_check ~ '(?<!SELECT )auth\.(uid|jwt|role|email)\(\)')
  loop
    new_qual := regexp_replace(p.qual, '(?<!SELECT )auth\.(uid|jwt|role|email)\(\)', '(select auth.\1())', 'g');
    new_check := regexp_replace(p.with_check, '(?<!SELECT )auth\.(uid|jwt|role|email)\(\)', '(select auth.\1())', 'g');
    stmt := format('alter policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    if new_qual is not null then
      stmt := stmt || format(' using (%s)', new_qual);
    end if;
    if new_check is not null then
      stmt := stmt || format(' with check (%s)', new_check);
    end if;
    execute stmt;
  end loop;
end;
$$;
