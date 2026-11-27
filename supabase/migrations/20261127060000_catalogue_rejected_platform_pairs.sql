-- Platforms and components, step B (proposals/PROPOSAL-catalogue-platforms-and-components.md):
-- "Suggested platforms".
--
-- * catalogue_rejected_platform_pairs: a record that a platform admin said a
--   product is not a component of the platform a suggestion named (by the words
--   its components share), with who and when stamped by the server, so the same
--   suggestion is not made again. A record only: nothing in the library changes,
--   and a row can be neither edited nor deleted from the browser.
-- No new callable function: the stamping trigger is revoked from public, anon and
-- authenticated. Platform admins only.

create table public.catalogue_rejected_platform_pairs (
  product_id uuid not null references public.catalogue_products(id) on delete cascade,
  platform_key text not null check (length(btrim(platform_key)) between 1 and 120),
  rejected_by uuid,
  rejected_by_name text check (length(btrim(rejected_by_name)) between 1 and 120),
  rejected_at timestamptz not null default now(),
  primary key (product_id, platform_key)
);

comment on table public.catalogue_rejected_platform_pairs is
  'A suggested platform a platform admin rejected for one product, with who and when. A record only.';

create function atlas.stamp_catalogue_rejected_platform_pair()
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
revoke all on function atlas.stamp_catalogue_rejected_platform_pair() from public, anon, authenticated;
create trigger catalogue_rejected_platform_pairs_stamp before insert on public.catalogue_rejected_platform_pairs
  for each row execute function atlas.stamp_catalogue_rejected_platform_pair();

alter table public.catalogue_rejected_platform_pairs enable row level security;
alter table public.catalogue_rejected_platform_pairs force row level security;

create policy catalogue_rejected_platform_pairs_admin_select on public.catalogue_rejected_platform_pairs
  for select to authenticated using (
    exists (select 1 from public.platform_admins pa where pa.user_id = (select auth.uid())));
create policy catalogue_rejected_platform_pairs_admin_insert on public.catalogue_rejected_platform_pairs
  for insert to authenticated with check (
    exists (select 1 from public.platform_admins pa where pa.user_id = (select auth.uid())));

revoke all on public.catalogue_rejected_platform_pairs from public, anon, authenticated;
grant select on public.catalogue_rejected_platform_pairs to authenticated;
-- Who and when are stamped by the server; the browser names only the product and the platform words.
grant insert (product_id, platform_key) on public.catalogue_rejected_platform_pairs to authenticated;
grant select, insert on public.catalogue_rejected_platform_pairs to service_role;
