-- F4 (docs/prompts/atlas-prompt-pack.md, "duplicates report (Q1)"), ADR-019's
-- "Amended (F4, ...)" paragraph, item 5: the nightly pg_cron sweep over the
-- identical detection code Step 3 already shipped (20260924020000_duplicate_check_rpcs.sql).
-- Secondary and separately-shipped on purpose — the on-demand "Check now"
-- button (Steps 3-5) is a fully working v1 with or without this migration;
-- nothing here changes what that path does.
--
-- Availability check before writing this (per the plan's own caution:
-- pg_cron is project/tier-dependent on hosted Supabase and not guaranteed
-- present in every local dev Postgres image): confirmed present and
-- installable on the live "Architecture" project (pg_cron 1.6.4 listed by
-- `list_extensions`, not yet installed) via a read-only Supabase MCP call —
-- no write was made to that project by this check. Local availability was
-- not independently exercised in this authoring sandbox (no Docker route to
-- `pnpm db:start`, the same limitation named throughout this sprint's own
-- migrations and *.integration.test.ts files); the local CLI's own Postgres
-- image is Supabase's standard `supabase/postgres` build, which bundles
-- pg_cron identically to the hosted platform, so this is expected to work
-- locally too but is flagged here rather than asserted as confirmed.

create extension if not exists pg_cron;

-- ---------------------------------------------------------------------------
-- atlas.run_scheduled_duplicate_checks() — never client-callable (no grant
-- to authenticated at all, below). Loops every model that opted in
-- (models.duplicates_check_enabled), calling the identical
-- atlas.run_duplicate_check RPC a person's own "Check now" button calls.
-- One model's own failure (a check already running there, or a real error —
-- which run_duplicate_check itself already records as a failed
-- duplicate_check_runs row before re-raising) is caught and logged, never
-- aborting the sweep for every other opted-in model.
--
-- auth.uid() is null for every call this function makes (pg_cron runs
-- inside Postgres, with no request/JWT context) — run_duplicate_check's own
-- role check only applies "if v_caller is not null", so a scheduled call is
-- always allowed, exactly per that function's own module comment: it only
-- ever acts on a model whose own toggle already opted it in.
-- ---------------------------------------------------------------------------

create or replace function atlas.run_scheduled_duplicate_checks()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_model record;
begin
  for v_model in select id from models where duplicates_check_enabled = true loop
    begin
      perform atlas.run_duplicate_check(v_model.id);
    exception when others then
      raise warning 'run_scheduled_duplicate_checks: model % failed: %', v_model.id, sqlerrm;
    end;
  end loop;
end;
$$;

-- Never client-callable — no `grant execute ... to authenticated` at all,
-- unlike every other atlas RPC in this schema. pg_cron invokes this as the
-- role that scheduled the job below (this migration's own deploying role),
-- which already has execute rights as the function's owner.
revoke all on function atlas.run_scheduled_duplicate_checks() from public;

-- 03:00 UTC daily. cron.schedule upserts by job name, so re-applying this
-- migration (e.g. a fresh `db reset`) updates the existing job rather than
-- creating a duplicate.
select cron.schedule('atlas-nightly-duplicate-check', '0 3 * * *', $$select atlas.run_scheduled_duplicate_checks();$$);
