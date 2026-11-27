-- Catalogue results presentation (proposals/PROPOSAL-catalogue-results-presentation.md):
--
-- * catalogue_source_checks gains "kept for now": a platform admin can hide a
--   moved, gone or could-not-check link until a date, with a short reason. The
--   server stamps who and when. A new check that finds a different result lifts
--   the hide. Nothing about a claim or a published revision changes.
-- * catalogue_product_merges: a record that one library product was merged into
--   another (the same product under two names), with who and when. The merged
--   product is kept, not deleted, and undoing a merge is deleting its record.
--   Platform admins only; who and when are stamped by the server.
-- No new callable function: the stamping triggers are revoked from public, anon
-- and authenticated (build rule 9).

alter table public.catalogue_source_checks
  add column hidden_until timestamptz,
  add column hidden_by uuid,
  add column hidden_by_name text check (length(btrim(hidden_by_name)) between 1 and 120),
  add column hidden_reason text check (length(btrim(hidden_reason)) between 1 and 200);

comment on column public.catalogue_source_checks.hidden_until is
  'Set by a platform admin to keep a flagged link out of the list until this date. Who and why are stamped alongside.';

create or replace function atlas.stamp_catalogue_source_check()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  -- A signed-in person is always who they are, whatever the request says. Only a server-side caller with no signed-in person (the service role, as the scheduled check is) may name who ran it.
  if auth.uid() is not null then
    new.checked_by := auth.uid();
    new.checked_by_name := atlas.catalogue_actor_name(auth.uid());
  end if;
  new.checked_at := now();
  -- A different result than last time lifts a hide, because what was kept is no longer what is there.
  if tg_op = 'UPDATE' and new.result is distinct from old.result and new.hidden_until is not distinct from old.hidden_until then
    new.hidden_until := null;
  end if;
  if new.hidden_until is null then
    new.hidden_by := null;
    new.hidden_by_name := null;
    new.hidden_reason := null;
  elsif tg_op = 'INSERT' or new.hidden_until is distinct from old.hidden_until then
    if auth.uid() is not null then
      new.hidden_by := auth.uid();
      new.hidden_by_name := atlas.catalogue_actor_name(auth.uid());
    end if;
  else
    -- Not a change to the hide: whatever the request says, who hid it stays as it was.
    new.hidden_by := old.hidden_by;
    new.hidden_by_name := old.hidden_by_name;
  end if;
  return new;
end;
$$;

create table public.catalogue_product_merges (
  merged_product_id uuid primary key references public.catalogue_products(id) on delete restrict,
  kept_product_id uuid not null references public.catalogue_products(id) on delete restrict,
  reason text check (length(btrim(reason)) between 1 and 300),
  merged_by uuid,
  merged_by_name text check (length(btrim(merged_by_name)) between 1 and 120),
  merged_at timestamptz not null default now(),
  check (merged_product_id <> kept_product_id)
);

create index catalogue_product_merges_kept_idx on public.catalogue_product_merges (kept_product_id);

comment on table public.catalogue_product_merges is
  'A product merged into another (the same product under two names), with who and when. The merged product is kept, never deleted. Deleting a row undoes the merge.';

create function atlas.stamp_catalogue_product_merge()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid();
begin
  new.merged_at := now();
  if v_user is not null then
    new.merged_by := v_user;
    new.merged_by_name := atlas.catalogue_actor_name(v_user);
  end if;
  -- A product that was merged into another cannot be the one others are merged into, and a kept product cannot be merged away.
  if exists (select 1 from public.catalogue_product_merges m where m.merged_product_id = new.kept_product_id)
     or exists (select 1 from public.catalogue_product_merges m where m.kept_product_id = new.merged_product_id) then
    raise exception 'Merge into the product that was kept, and do not merge a product that others were merged into.';
  end if;
  return new;
end;
$$;
revoke all on function atlas.stamp_catalogue_product_merge() from public, anon, authenticated;
create trigger catalogue_product_merges_stamp before insert on public.catalogue_product_merges
  for each row execute function atlas.stamp_catalogue_product_merge();

alter table public.catalogue_product_merges enable row level security;
alter table public.catalogue_product_merges force row level security;

create policy catalogue_product_merges_admin_select on public.catalogue_product_merges
  for select to authenticated using (
    exists (select 1 from public.platform_admins pa where pa.user_id = (select auth.uid())));
create policy catalogue_product_merges_admin_insert on public.catalogue_product_merges
  for insert to authenticated with check (
    exists (select 1 from public.platform_admins pa where pa.user_id = (select auth.uid())));
create policy catalogue_product_merges_admin_delete on public.catalogue_product_merges
  for delete to authenticated using (
    exists (select 1 from public.platform_admins pa where pa.user_id = (select auth.uid())));

revoke all on public.catalogue_product_merges from public, anon, authenticated;
grant select, delete on public.catalogue_product_merges to authenticated;
-- Who and when are stamped by the server; the browser names only the two products and a reason.
grant insert (merged_product_id, kept_product_id, reason) on public.catalogue_product_merges to authenticated;
grant select, insert, delete on public.catalogue_product_merges to service_role;
