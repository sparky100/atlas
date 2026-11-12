-- Stale-data threshold and owner nudges.
--
--   organisations.stale_after_months — how many months a value can go
--     unchecked before it is flagged stale (default 12, the number that used
--     to be the global constant STALE_AFTER_MONTHS). Set through
--     atlas.set_stale_threshold (owner or architect), same shape as
--     atlas.set_review_period.
--   user_preferences.email_on_stale_nudge — a person's own opt-out of the
--     "these need checking" email. Read by the send-review-email edge
--     function (service role).
--   stale_nudges — one row per person per model per day a nudge email was
--     sent. The unique key is the claim that stops two presses of "Send
--     reminders" from emailing someone twice on the same day; the edge
--     function also skips anyone nudged in the last 7 days. Operational log
--     only: written by the edge function with the service role, readable by
--     owners and architects, never by application code as a model fact.
--   atlas.stale_elements / atlas.stale_nudge_recipients — which elements on
--     main have a value older than the organisation's threshold, and who
--     should be told. Service role only; the edge function enforces that the
--     caller is an owner or architect before it asks.
--
-- A fact's date is its effective_date, else the day its delta was committed
-- (the same rule the app uses, src/contracts/thresholds.ts). The `$exists`
-- fact is ignored: it records that the element was created, "Still accurate"
-- cannot re-assert it (ADR-025), so counting it would keep every old element
-- stale for ever.

alter table organisations add column stale_after_months int not null default 12 check (stale_after_months between 1 and 60);

comment on column organisations.stale_after_months is 'Months a value can go unchecked before it is flagged stale (default 12, 1-60). Set only through atlas.set_stale_threshold (owner/architect).';

create or replace function atlas.set_stale_threshold(p_org_id uuid, p_months int)
returns organisations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row organisations;
begin
  if not atlas.has_role(p_org_id, 'owner', 'architect') then
    raise exception 'Only an owner or architect can change the stale-data threshold.' using errcode = '42501';
  end if;
  if p_months is null or p_months < 1 or p_months > 60 then
    raise exception 'The stale-data threshold must be between 1 and 60 months.' using errcode = '22023';
  end if;
  update organisations set stale_after_months = p_months where id = p_org_id returning * into v_row;
  return v_row;
end;
$$;

revoke all on function atlas.set_stale_threshold(uuid, int) from public;
grant execute on function atlas.set_stale_threshold(uuid, int) to authenticated;

alter table user_preferences add column email_on_stale_nudge boolean not null default true;

comment on column user_preferences.email_on_stale_nudge is 'Whether this user is emailed when elements they own (or, as an architect, elements nobody owns) have gone stale. Opting out only stops the email; the items still show on Home.';

create table stale_nudges (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations (id),
  model_id uuid not null references models (id) on delete cascade,
  user_id uuid not null references auth.users (id),
  sent_on date not null default current_date,
  item_count int not null check (item_count > 0),
  created_at timestamptz not null default now(),
  unique (model_id, user_id, sent_on)
);

comment on table stale_nudges is 'One row per person per model per day a stale-data email was sent (or is being sent: the row is the claim). Written by the send-review-email edge function with the service role; owners and architects can read it.';

alter table stale_nudges enable row level security;
alter table stale_nudges force row level security;

create policy stale_nudges_select on stale_nudges
  for select to authenticated
  using (atlas.has_role(org_id, 'owner', 'architect'));

grant select on stale_nudges to authenticated;

-- ---------------------------------------------------------------------------
-- Which elements on main have at least one value older than the threshold.
-- ---------------------------------------------------------------------------

create or replace function atlas.stale_elements(p_model_id uuid)
returns table (element_id uuid, element_type element_type, name text, stale_fact_count int, oldest_fact_date date)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select e.element_id, e.element_type, e.name, count(*)::int, min(coalesce(f.effective_date, f.asserted_at::date))
  from branches b
  join organisations o on o.id = b.org_id
  join elements_head e on e.commit_id = b.head_commit_id and e.model_id = b.model_id
  join facts f on f.commit_id = b.head_commit_id and f.subject_type = 'element' and f.subject_id = e.element_id and f.attribute <> '$exists'
  where b.model_id = p_model_id
    and b.kind = 'main'
    and coalesce(f.effective_date, f.asserted_at::date) <= (current_date - make_interval(months => o.stale_after_months))
  group by e.element_id, e.element_type, e.name
$$;

revoke all on function atlas.stale_elements(uuid) from public;
grant execute on function atlas.stale_elements(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Who should be told about each stale element.
--
-- An owner is the member behind an actor that has a business or technical
-- `owns` edge to the element (the actor's `memberId`, the same bridge a
-- review's derived reviewer set uses, src/db/deriveReviewers.ts). An element
-- with no owner who resolves to a current member goes to the organisation's
-- architects instead (as_fallback = true), or to its owners when it has no
-- architect, so an unowned stale element is never silently dropped.
-- ---------------------------------------------------------------------------

create or replace function atlas.stale_nudge_recipients(p_model_id uuid)
returns table (user_id uuid, element_id uuid, element_name text, element_type element_type, oldest_fact_date date, as_fallback boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with main as (
    select b.head_commit_id as commit_id, b.org_id from branches b where b.model_id = p_model_id and b.kind = 'main'
  ),
  stale as (
    select * from atlas.stale_elements(p_model_id)
  ),
  owned as (
    select distinct s.element_id, (a.attributes ->> 'memberId')::uuid as user_id
    from stale s
    join main on true
    join relationships_head r on r.commit_id = main.commit_id and r.relationship_type = 'owns' and r.to_element_id = s.element_id and (r.attributes ->> 'role') in ('business', 'technical')
    join elements_head a on a.commit_id = main.commit_id and a.element_id = r.from_element_id
    join members m on m.org_id = main.org_id and m.user_id = (a.attributes ->> 'memberId')::uuid
    where (a.attributes ->> 'memberId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  fallback_role as (
    select case when exists (select 1 from members m join main on m.org_id = main.org_id where m.role = 'architect') then 'architect'::member_role else 'owner'::member_role end as role
  ),
  fallback_people as (
    select m.user_id from members m join main on m.org_id = main.org_id join fallback_role fr on fr.role = m.role
  )
  select o.user_id, s.element_id, s.name, s.element_type, s.oldest_fact_date, false
  from owned o join stale s on s.element_id = o.element_id
  union all
  select p.user_id, s.element_id, s.name, s.element_type, s.oldest_fact_date, true
  from stale s
  cross join fallback_people p
  where not exists (select 1 from owned o where o.element_id = s.element_id)
$$;

revoke all on function atlas.stale_nudge_recipients(uuid) from public;
grant execute on function atlas.stale_nudge_recipients(uuid) to service_role;
