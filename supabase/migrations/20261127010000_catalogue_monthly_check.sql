-- Catalogue step 5b-2 (proposals/WALKTHROUGH-catalogue-step-5b-2-monthly-check.md):
-- a monthly, unattended run of the link check and the AI claim check, and a
-- record of every run (manual or monthly).
--
-- * catalogue_check_schedule: one row, an on/off switch. It starts OFF. A
--   platform admin switches it; the server stamps who and when, and the monthly
--   run's results name that person ("Monthly check (switched on by <name>)").
-- * catalogue_check_runs: who started a check, what it covered, what it found,
--   tokens used. Manual runs are written by the browser under admin RLS;
--   monthly runs by the monthly function.
-- * A pg_cron job calls the `catalogue-monthly-check` edge function through
--   pg_net on days 1 to 3 of each month, in small batches that resume until
--   every claim has a check newer than 25 days. The function proves it was
--   called by this job with a secret generated here, held only in Vault.
--
-- A record only: nothing here edits a claim, flags a published revision or
-- unpublishes anything. Platform admins only. No new function is callable
-- through the API (build rule 9): the stamping triggers and the job's function
-- are revoked from public, anon and authenticated.

create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------------------
-- The switch
-- ---------------------------------------------------------------------------
create table public.catalogue_check_schedule (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  switched_by uuid,
  switched_by_name text check (length(btrim(switched_by_name)) between 1 and 120),
  switched_at timestamptz,
  check (not enabled or switched_by is not null)
);

comment on table public.catalogue_check_schedule is
  'One row: whether the monthly catalogue check runs, and who last switched it. Starts off.';

-- The single row of configuration, off.
insert into public.catalogue_check_schedule (id, enabled) values (true, false);

create function atlas.stamp_catalogue_check_schedule()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is not null then
    new.switched_by := v_user;
    new.switched_by_name := atlas.catalogue_actor_name(v_user);
    new.switched_at := now();
  end if;
  return new;
end;
$$;
revoke all on function atlas.stamp_catalogue_check_schedule() from public, anon, authenticated;
create trigger catalogue_check_schedule_stamp before update on public.catalogue_check_schedule
  for each row execute function atlas.stamp_catalogue_check_schedule();

alter table public.catalogue_check_schedule enable row level security;
alter table public.catalogue_check_schedule force row level security;

create policy catalogue_check_schedule_admin_select on public.catalogue_check_schedule
  for select to authenticated using (
    exists (select 1 from public.platform_admins pa where pa.user_id = (select auth.uid())));
create policy catalogue_check_schedule_admin_update on public.catalogue_check_schedule
  for update to authenticated
  using (exists (select 1 from public.platform_admins pa where pa.user_id = (select auth.uid())))
  with check (exists (select 1 from public.platform_admins pa where pa.user_id = (select auth.uid())));

revoke all on public.catalogue_check_schedule from public, anon, authenticated;
grant select on public.catalogue_check_schedule to authenticated;
-- Only the switch itself can be changed from the browser; who and when are stamped by the server.
grant update (enabled) on public.catalogue_check_schedule to authenticated;
grant select, update on public.catalogue_check_schedule to service_role;

-- ---------------------------------------------------------------------------
-- The run record
-- ---------------------------------------------------------------------------
create table public.catalogue_check_runs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('manual', 'monthly')),
  scope text not null check (scope in ('links', 'claims', 'both')),
  status text not null default 'running' check (status in ('running', 'finished', 'stopped', 'limit_reached', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  started_by uuid,
  started_by_name text check (length(btrim(started_by_name)) between 1 and 120),
  links_checked int not null default 0 check (links_checked >= 0),
  claims_checked int not null default 0 check (claims_checked >= 0),
  flagged int not null default 0 check (flagged >= 0),
  input_tokens int not null default 0 check (input_tokens >= 0),
  output_tokens int not null default 0 check (output_tokens >= 0),
  note text check (length(note) <= 300)
);

create index catalogue_check_runs_started_idx on public.catalogue_check_runs (started_at desc);

comment on table public.catalogue_check_runs is
  'One row per catalogue check run, manual or monthly: who started it, what it covered, what it found and the tokens it used. A record only.';

create function atlas.stamp_catalogue_check_run()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    new.started_at := now();
    new.finished_at := null;
    if v_user is not null then
      new.started_by := v_user;
      new.started_by_name := atlas.catalogue_actor_name(v_user);
    end if;
    return new;
  end if;
  -- Who started it and when never change; a run that stops running gets its end time from the server.
  new.id := old.id; new.kind := old.kind; new.scope := old.scope;
  new.started_at := old.started_at; new.started_by := old.started_by; new.started_by_name := old.started_by_name;
  if new.status <> 'running' and old.status = 'running' then
    new.finished_at := now();
  else
    new.finished_at := old.finished_at;
  end if;
  return new;
end;
$$;
revoke all on function atlas.stamp_catalogue_check_run() from public, anon, authenticated;
create trigger catalogue_check_runs_stamp before insert or update on public.catalogue_check_runs
  for each row execute function atlas.stamp_catalogue_check_run();

alter table public.catalogue_check_runs enable row level security;
alter table public.catalogue_check_runs force row level security;

create policy catalogue_check_runs_admin_select on public.catalogue_check_runs
  for select to authenticated using (
    exists (select 1 from public.platform_admins pa where pa.user_id = (select auth.uid())));
create policy catalogue_check_runs_admin_insert on public.catalogue_check_runs
  for insert to authenticated with check (
    kind = 'manual' and exists (select 1 from public.platform_admins pa where pa.user_id = (select auth.uid())));
create policy catalogue_check_runs_admin_update on public.catalogue_check_runs
  for update to authenticated
  using (kind = 'manual' and exists (select 1 from public.platform_admins pa where pa.user_id = (select auth.uid())))
  with check (kind = 'manual' and exists (select 1 from public.platform_admins pa where pa.user_id = (select auth.uid())));

revoke all on public.catalogue_check_runs from public, anon, authenticated;
grant select on public.catalogue_check_runs to authenticated;
grant insert (kind, scope) on public.catalogue_check_runs to authenticated;
grant update (status, links_checked, claims_checked, flagged, input_tokens, output_tokens, note) on public.catalogue_check_runs to authenticated;
grant select, insert, update on public.catalogue_check_runs to service_role;

-- ---------------------------------------------------------------------------
-- The secret, the job, and what it calls
-- ---------------------------------------------------------------------------
-- Generated here from the database's own randomness and held only in Vault: nobody, including the person deploying this, sees it.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'catalogue:schedule_secret') then
    perform vault.create_secret(
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      'catalogue:schedule_secret',
      'Proves a call to catalogue-monthly-check came from the monthly job');
  end if;
end;
$$;

-- Read by the catalogue-monthly-check function with the service-role key, nobody else.
create function atlas.catalogue_schedule_secret()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'catalogue:schedule_secret';
$$;
revoke all on function atlas.catalogue_schedule_secret() from public, anon, authenticated;
grant execute on function atlas.catalogue_schedule_secret() to service_role;

-- Called only by pg_cron. The function's address is a Vault secret named catalogue:schedule_url (set once by hand
-- after deploy, never in this repository); until it is set, or while the switch is off, a tick does nothing.
create function atlas.run_monthly_catalogue_check()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_enabled boolean;
  v_url text;
  v_secret text;
begin
  select s.enabled into v_enabled from public.catalogue_check_schedule s;
  if v_enabled is not true then return; end if;
  select d.decrypted_secret into v_url from vault.decrypted_secrets d where d.name = 'catalogue:schedule_url';
  select d.decrypted_secret into v_secret from vault.decrypted_secrets d where d.name = 'catalogue:schedule_secret';
  if v_url is null or v_secret is null then
    raise warning 'run_monthly_catalogue_check: the function address or secret is not set';
    return;
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-schedule-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000);
end;
$$;
revoke all on function atlas.run_monthly_catalogue_check() from public, anon, authenticated;

-- Days 1 to 3, every 30 minutes from 03:00 to 05:30 UTC. Each tick checks a small batch and stops at once when nothing is left,
-- so a month's pass normally finishes on day 1. cron.schedule upserts by name, so re-applying this migration does not duplicate the job.
select cron.schedule('atlas-catalogue-monthly-check', '*/30 3-5 1-3 * *', $$select atlas.run_monthly_catalogue_check();$$);
