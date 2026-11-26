-- Catalogue step 5b-1 (proposals/WALKTHROUGH-catalogue-step-5b-claim-check.md):
-- record whether a claim still matches the page it cites, as read by the
-- platform's AI. One row per product, source link and exact claim text, so a
-- check survives unrelated edits and an edited claim correctly becomes "not
-- checked". The AI must quote a sentence from the page; the function verifies
-- the quote before it answers "supported" or "changed". A person clears a flag
-- with "I looked: it still stands", recorded with a name and a date.
--
-- A record only: nothing here edits a claim, flags a published revision or
-- unpublishes anything. Platform admins only; the server stamps who and when.
-- No new callable function (build rule 9): the stamping trigger and its helper
-- are not executable through the API.

create table public.catalogue_claim_checks (
  product_id uuid not null references public.catalogue_products(id) on delete cascade,
  source_url text not null check (length(source_url) between 1 and 2000),
  statement text not null check (length(btrim(statement)) between 1 and 400),
  verdict text not null check (verdict in ('supported', 'changed', 'cant_tell')),
  quote text check (length(quote) <= 600),
  note text check (length(note) <= 200),
  model text check (length(model) <= 80),
  input_tokens int not null default 0 check (input_tokens >= 0),
  output_tokens int not null default 0 check (output_tokens >= 0),
  checked_at timestamptz not null default now(),
  checked_by uuid not null,
  checked_by_name text check (length(btrim(checked_by_name)) between 1 and 120),
  dismissed_at timestamptz,
  dismissed_by uuid,
  dismissed_by_name text check (length(btrim(dismissed_by_name)) between 1 and 120),
  primary key (product_id, source_url, statement),
  check (verdict <> 'supported' or quote is not null),
  check ((dismissed_at is null) = (dismissed_by is null))
);

create index catalogue_claim_checks_checked_idx on public.catalogue_claim_checks (checked_at desc);

comment on table public.catalogue_claim_checks is
  'Latest AI check of one claim against its cited page: supported, changed or cant_tell, with the quoted sentence, the model and tokens used, and any "I looked: it still stands" by a person. A record only: nothing here edits a claim or unpublishes a product.';

create function atlas.stamp_catalogue_claim_check()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    new.dismissed_at := null; new.dismissed_by := null; new.dismissed_by_name := null;
    if v_user is not null then
      new.checked_by := v_user;
      new.checked_by_name := atlas.catalogue_actor_name(v_user);
    end if;
    new.checked_at := now();
    return new;
  end if;

  if new.dismissed_at is not null and old.dismissed_at is null then
    -- "I looked: it still stands": only the dismissal changes, and it is stamped here.
    new.verdict := old.verdict; new.quote := old.quote; new.note := old.note; new.model := old.model;
    new.input_tokens := old.input_tokens; new.output_tokens := old.output_tokens;
    new.checked_at := old.checked_at; new.checked_by := old.checked_by; new.checked_by_name := old.checked_by_name;
    new.dismissed_at := now();
    if v_user is not null then
      new.dismissed_by := v_user;
      new.dismissed_by_name := atlas.catalogue_actor_name(v_user);
    end if;
    return new;
  end if;

  -- Anything else is a new check: it replaces the result and clears an earlier dismissal.
  new.dismissed_at := null; new.dismissed_by := null; new.dismissed_by_name := null;
  if v_user is not null then
    new.checked_by := v_user;
    new.checked_by_name := atlas.catalogue_actor_name(v_user);
  end if;
  new.checked_at := now();
  return new;
end;
$$;
revoke all on function atlas.stamp_catalogue_claim_check() from public, anon, authenticated;
create trigger catalogue_claim_checks_stamp before insert or update on public.catalogue_claim_checks
  for each row execute function atlas.stamp_catalogue_claim_check();

alter table public.catalogue_claim_checks enable row level security;
alter table public.catalogue_claim_checks force row level security;

create policy catalogue_claim_checks_admin_select on public.catalogue_claim_checks
  for select to authenticated using (
    exists (select 1 from public.platform_admins pa where pa.user_id = (select auth.uid())));
create policy catalogue_claim_checks_admin_insert on public.catalogue_claim_checks
  for insert to authenticated with check (
    exists (select 1 from public.platform_admins pa where pa.user_id = (select auth.uid())));
create policy catalogue_claim_checks_admin_update on public.catalogue_claim_checks
  for update to authenticated
  using (exists (select 1 from public.platform_admins pa where pa.user_id = (select auth.uid())))
  with check (exists (select 1 from public.platform_admins pa where pa.user_id = (select auth.uid())));

revoke all on public.catalogue_claim_checks from public, anon, authenticated;
grant select, insert, update on public.catalogue_claim_checks to authenticated;
grant select, insert, update, delete on public.catalogue_claim_checks to service_role;
