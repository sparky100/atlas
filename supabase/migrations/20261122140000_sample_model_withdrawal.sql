-- Withdraw a published sample model without deleting or editing any version.
-- A sample is identified by its slug; withdrawing it hides every version from
-- ordinary signed-in users while platform admins keep the rows and the audit
-- trail. A later reinstatement makes the same slug available again. Copies
-- already made by organisations are their own models and are not recalled.

create table public.sample_model_withdrawal_events (
  id uuid primary key default gen_random_uuid(),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  action text not null check (action in ('withdrawn', 'reinstated')),
  reason text check (reason is null or length(btrim(reason)) between 1 and 500),
  actor_id uuid not null references auth.users (id),
  happened_at timestamptz not null default now(),
  check (action = 'reinstated' or reason is not null)
);
create index sample_model_withdrawal_events_slug_idx
  on public.sample_model_withdrawal_events (slug, happened_at desc);

comment on table public.sample_model_withdrawal_events is
  'Append-only withdrawal and reinstatement history for sample model slugs. Never changes a published sample version.';

alter table public.sample_model_withdrawal_events enable row level security;
alter table public.sample_model_withdrawal_events force row level security;

create policy sample_model_withdrawal_events_admin_read on public.sample_model_withdrawal_events
  for select to authenticated using
    (exists (select 1 from public.platform_admins where user_id = (select auth.uid())));

revoke all on public.sample_model_withdrawal_events from public, anon, authenticated;
grant select on public.sample_model_withdrawal_events to authenticated;
grant select, insert, delete on public.sample_model_withdrawal_events to service_role;

-- Security definer: the policy on sample_models must be able to ask this
-- without the caller being able to read the event rows. It returns only the
-- current boolean state.
create function atlas.sample_model_withdrawn(p_slug text)
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select coalesce((
    select e.action = 'withdrawn'
    from public.sample_model_withdrawal_events e
    where e.slug = p_slug
    order by e.happened_at desc, e.id desc
    limit 1
  ), false);
$$;
revoke all on function atlas.sample_model_withdrawn(text) from public, anon;
grant execute on function atlas.sample_model_withdrawn(text) to authenticated, service_role;

-- A withdrawn slug must be reinstated before another version can be added.
-- This is enforced in the database, not only in the publish screen.
create function atlas.guard_sample_model_not_withdrawn()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if atlas.sample_model_withdrawn(new.slug) then
    raise exception 'This sample is withdrawn; reinstate it before publishing another version' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function atlas.guard_sample_model_not_withdrawn() from public, anon, authenticated;
create trigger sample_models_guard_withdrawn before insert on public.sample_models
for each row execute function atlas.guard_sample_model_not_withdrawn();

-- Ordinary signed-in users see only samples that are currently shared.
-- Platform admins keep seeing withdrawn rows so they can manage them.
drop policy sample_models_select on public.sample_models;
create policy sample_models_select on public.sample_models
  for select to authenticated using (
    exists (select 1 from public.platform_admins pa where pa.user_id = (select auth.uid()))
    or not atlas.sample_model_withdrawn(slug)
  );

create function atlas.withdraw_sample_model(p_slug text, p_reason text)
returns void language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.platform_admins where user_id = auth.uid()) is not true then
    raise exception 'platform admin required' using errcode = '42501';
  end if;
  if p_slug is null or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    or not exists (select 1 from public.sample_models where slug = p_slug) then
    raise exception 'That sample does not exist' using errcode = '22023';
  end if;
  if atlas.sample_model_withdrawn(p_slug) then
    raise exception 'That sample is already withdrawn' using errcode = '22023';
  end if;
  if nullif(btrim(p_reason), '') is null or length(btrim(p_reason)) > 500 then
    raise exception 'Give a reason for withdrawing this sample (500 characters at most)' using errcode = '22023';
  end if;
  insert into public.sample_model_withdrawal_events (slug, action, reason, actor_id)
  values (p_slug, 'withdrawn', btrim(p_reason), auth.uid());
end;
$$;
revoke all on function atlas.withdraw_sample_model(text, text) from public, anon;
grant execute on function atlas.withdraw_sample_model(text, text) to authenticated;

create function atlas.reinstate_sample_model(p_slug text, p_reason text default null)
returns void language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.platform_admins where user_id = auth.uid()) is not true then
    raise exception 'platform admin required' using errcode = '42501';
  end if;
  if p_slug is null or not exists (select 1 from public.sample_models where slug = p_slug) then
    raise exception 'That sample does not exist' using errcode = '22023';
  end if;
  if not atlas.sample_model_withdrawn(p_slug) then
    raise exception 'That sample is already shared' using errcode = '22023';
  end if;
  if p_reason is not null and length(btrim(p_reason)) > 500 then
    raise exception 'The note is too long (500 characters at most)' using errcode = '22023';
  end if;
  insert into public.sample_model_withdrawal_events (slug, action, reason, actor_id)
  values (p_slug, 'reinstated', nullif(btrim(p_reason), ''), auth.uid());
end;
$$;
revoke all on function atlas.reinstate_sample_model(text, text) from public, anon;
grant execute on function atlas.reinstate_sample_model(text, text) to authenticated;
