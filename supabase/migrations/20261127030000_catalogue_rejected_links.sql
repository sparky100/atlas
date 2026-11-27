-- Catalogue step 6b (proposals/WALKTHROUGH-catalogue-step-6b-find-for-set.md):
-- "Find products for this set".
--
-- * catalogue_rejected_links: a record of a proposed product-to-capability link
--   that a platform admin turned down, with the reason, who and when (stamped by
--   the server), so the same suggestion is not made again. A record only:
--   nothing in the library changes, and a row can be neither edited nor deleted
--   from the browser.
-- * The run record accepts the scope "find_set".
-- No new callable function: the stamping trigger is revoked from public, anon and
-- authenticated. Platform admins only.

do $$
declare v_name text;
begin
  select c.conname into v_name from pg_constraint c
    where c.conrelid = 'public.catalogue_check_runs'::regclass and c.contype = 'c'
      and pg_get_constraintdef(c.oid) like '%scope%' limit 1;
  if v_name is not null then
    execute format('alter table public.catalogue_check_runs drop constraint %I', v_name);
  end if;
end;
$$;
alter table public.catalogue_check_runs
  add constraint catalogue_check_runs_scope_check check (scope in ('links', 'claims', 'both', 'find', 'find_set'));

create table public.catalogue_rejected_links (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.catalogue_products(id) on delete cascade,
  capability_map_id uuid not null references public.capability_maps(id) on delete restrict,
  capability_code text not null check (length(btrim(capability_code)) between 1 and 40),
  capability_name text not null check (length(btrim(capability_name)) between 1 and 200),
  reason text not null check (length(btrim(reason)) between 1 and 300),
  rejected_by uuid,
  rejected_by_name text check (length(btrim(rejected_by_name)) between 1 and 120),
  rejected_at timestamptz not null default now(),
  unique (product_id, capability_map_id, capability_code)
);

create index catalogue_rejected_links_map_idx on public.catalogue_rejected_links (capability_map_id);

comment on table public.catalogue_rejected_links is
  'A proposed product-to-capability link a platform admin rejected, with reason, who and when. A record only.';

create function atlas.stamp_catalogue_rejected_link()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid();
begin
  new.rejected_at := now();
  if v_user is not null then
    new.rejected_by := v_user;
    new.rejected_by_name := atlas.catalogue_actor_name(v_user);
  end if;
  return new;
end;
$$;
revoke all on function atlas.stamp_catalogue_rejected_link() from public, anon, authenticated;
create trigger catalogue_rejected_links_stamp before insert on public.catalogue_rejected_links
  for each row execute function atlas.stamp_catalogue_rejected_link();

alter table public.catalogue_rejected_links enable row level security;
alter table public.catalogue_rejected_links force row level security;

create policy catalogue_rejected_links_admin_select on public.catalogue_rejected_links
  for select to authenticated using (
    exists (select 1 from public.platform_admins pa where pa.user_id = (select auth.uid())));
create policy catalogue_rejected_links_admin_insert on public.catalogue_rejected_links
  for insert to authenticated with check (
    exists (select 1 from public.platform_admins pa where pa.user_id = (select auth.uid())));

revoke all on public.catalogue_rejected_links from public, anon, authenticated;
grant select on public.catalogue_rejected_links to authenticated;
-- Who and when are stamped by the server; the browser names only the pair and the reason.
grant insert (product_id, capability_map_id, capability_code, capability_name, reason) on public.catalogue_rejected_links to authenticated;
grant select, insert on public.catalogue_rejected_links to service_role;
