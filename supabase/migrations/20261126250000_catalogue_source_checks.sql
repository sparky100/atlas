-- Catalogue step 5a (proposals/WALKTHROUGH-catalogue-step-5a-link-check.md):
-- record whether each claim's source link still works. One row per distinct
-- source URL, so a check survives edits to the claims that cite it (saving a
-- product replaces its claim rows). A check says what was found, when and by
-- whom; it never changes a claim or a published revision.
--
-- Platform admins only: they read, and write results from the browser with
-- their own session. The server stamps who and when, so a browser cannot say
-- another admin ran it. No new callable function: the stamping trigger and its
-- helper are not executable through the API (build rule 9).

create table public.catalogue_source_checks (
  url text primary key check (length(url) between 1 and 2000),
  result text not null check (result in ('works', 'moved', 'gone', 'could_not_check')),
  http_status int check (http_status between 100 and 599),
  final_url text check (length(final_url) <= 2000),
  note text check (length(note) <= 200),
  checked_at timestamptz not null default now(),
  checked_by uuid not null,
  checked_by_name text check (length(btrim(checked_by_name)) between 1 and 120)
);

comment on table public.catalogue_source_checks is
  'Latest check of one claim source link: works, moved, gone or could not check, with when and by whom. A record only: nothing here unpublishes or edits a claim.';

create function atlas.stamp_catalogue_source_check()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  -- A signed-in person is always who they are, whatever the request says. Only a server-side caller with no signed-in person (the service role, as a later scheduled check will be) may name who ran it.
  if auth.uid() is not null then
    new.checked_by := auth.uid();
    new.checked_by_name := atlas.catalogue_actor_name(auth.uid());
  end if;
  new.checked_at := now();
  return new;
end;
$$;
revoke all on function atlas.stamp_catalogue_source_check() from public, anon, authenticated;
create trigger catalogue_source_checks_stamp before insert or update on public.catalogue_source_checks
  for each row execute function atlas.stamp_catalogue_source_check();

alter table public.catalogue_source_checks enable row level security;
alter table public.catalogue_source_checks force row level security;

create policy catalogue_source_checks_admin_select on public.catalogue_source_checks
  for select to authenticated using (
    exists (select 1 from public.platform_admins pa where pa.user_id = (select auth.uid())));
create policy catalogue_source_checks_admin_insert on public.catalogue_source_checks
  for insert to authenticated with check (
    exists (select 1 from public.platform_admins pa where pa.user_id = (select auth.uid())));
create policy catalogue_source_checks_admin_update on public.catalogue_source_checks
  for update to authenticated
  using (exists (select 1 from public.platform_admins pa where pa.user_id = (select auth.uid())))
  with check (exists (select 1 from public.platform_admins pa where pa.user_id = (select auth.uid())));

revoke all on public.catalogue_source_checks from public, anon, authenticated;
grant select, insert, update on public.catalogue_source_checks to authenticated;
grant select, insert, update, delete on public.catalogue_source_checks to service_role;
