-- D1 candidate options, stage 1: additive identity and compatibility keys.
--
-- An option is currently a `branches` row with `kind = 'change'`. This
-- migration starts separating the candidate from its eventual change branch
-- without changing any runtime path:
--   * `decision_options` gives every existing option one stable identity;
--   * `branch_id` is nullable, so a later stage can store a candidate with no
--     change branch yet;
--   * ratings, marks, catalogue sources and web sources gain an `option_id`
--     and are backfilled from the branch they already name.
--
-- Reads and writes stay on `branch_id` in this migration. Stage 2 switches the
-- decision page to options; stage 3 creates branches only on work/choose; stage
-- 4 removes the compatibility keys.

create table public.decision_options (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references public.decisions (id) on delete cascade,
  -- Null until the option is worked on or chosen. One option may have one
  -- branch; a branch is never reused as an option on another decision.
  branch_id uuid references public.branches (id) on delete set null,
  title text not null check (length(btrim(title)) between 1 and 200),
  summary text not null default '' check (length(summary) <= 2000),
  to_weigh text not null default '' check (length(to_weigh) <= 2000),
  position int not null default 0,
  source text not null default 'manual' check (source in ('manual', 'designer')),
  agent text check (agent is null or agent = 'designer'),
  drafted_at timestamptz,
  draft_run_id uuid,
  edited_by uuid,
  edited_at timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_by uuid not null,
  updated_at timestamptz not null default now(),
  unique (decision_id, branch_id),
  check ((edited_by is null) = (edited_at is null)),
  check ((source = 'designer') = (agent is not null))
);
create index decision_options_decision_idx on public.decision_options (decision_id, position);
create index decision_options_branch_idx on public.decision_options (branch_id)
  where branch_id is not null;

comment on table public.decision_options is
  'D1 stage 1: a decision option as a candidate, with an optional change branch. Existing options are backfilled from decision_links.';

alter table public.decision_options enable row level security;
alter table public.decision_options force row level security;

create policy decision_options_select on public.decision_options
  for select to authenticated using (
    exists (select 1 from public.decisions d
      where d.id = decision_options.decision_id and atlas.is_member(d.org_id))
  );

create policy decision_options_insert on public.decision_options
  for insert to authenticated with check (
    created_by = (select auth.uid())
    and updated_by = (select auth.uid())
    and exists (select 1 from public.decisions d
      where d.id = decision_options.decision_id
        and d.status = 'proposed'
        and atlas.has_role(d.org_id, 'owner', 'architect', 'contributor'))
    and (branch_id is null or exists (
      select 1 from public.decision_links l
      where l.decision_id = decision_options.decision_id
        and l.linked_type = 'branch' and l.linked_id = decision_options.branch_id
    ))
  );

create policy decision_options_update on public.decision_options
  for update to authenticated using (
    exists (select 1 from public.decisions d
      where d.id = decision_options.decision_id
        and d.status = 'proposed'
        and atlas.has_role(d.org_id, 'owner', 'architect', 'contributor'))
  ) with check (
    updated_by = (select auth.uid())
    and exists (select 1 from public.decisions d
      where d.id = decision_options.decision_id
        and d.status = 'proposed'
        and atlas.has_role(d.org_id, 'owner', 'architect', 'contributor'))
    and (branch_id is null or exists (
      select 1 from public.decision_links l
      where l.decision_id = decision_options.decision_id
        and l.linked_type = 'branch' and l.linked_id = decision_options.branch_id
    ))
  );

revoke all on public.decision_options from public, anon, authenticated;
grant select, insert, update on public.decision_options to authenticated;
grant select, insert, update, delete on public.decision_options to service_role;

-- One option row per existing branch-typed option. The branch title/description
-- already carry the wording the person saw; the Designer mark (when present)
-- supplies the agent provenance below.
insert into public.decision_options
  (decision_id, branch_id, title, summary, position, created_by, created_at, updated_by, updated_at)
select l.decision_id, b.id,
  left(coalesce(nullif(btrim(b.title), ''), nullif(btrim(b.name), ''), 'Option'), 200),
  left(coalesce(b.description, ''), 2000),
  (row_number() over (partition by l.decision_id order by l.created_at, b.id))::int,
  l.created_by, l.created_at, l.created_by, l.created_at
from public.decision_links l
join public.branches b on b.id = l.linked_id
where l.linked_type = 'branch'
on conflict (decision_id, branch_id) do nothing;

update public.decision_options o
set source = 'designer', agent = 'designer', drafted_at = m.drafted_at,
    draft_run_id = m.draft_run_id, edited_by = m.edited_by, edited_at = m.edited_at
from public.decision_option_marks m
where m.decision_id = o.decision_id and m.branch_id = o.branch_id;

alter table public.decision_option_ratings add column option_id uuid references public.decision_options (id);
alter table public.decision_option_marks add column option_id uuid references public.decision_options (id);
alter table public.option_catalogue_sources add column option_id uuid references public.decision_options (id);
alter table public.option_web_sources add column option_id uuid references public.decision_options (id);

create index decision_option_ratings_option_idx on public.decision_option_ratings (option_id) where option_id is not null;
create index decision_option_marks_option_idx on public.decision_option_marks (option_id) where option_id is not null;
create index option_catalogue_sources_option_idx on public.option_catalogue_sources (option_id) where option_id is not null;
create index option_web_sources_option_idx on public.option_web_sources (option_id) where option_id is not null;

update public.decision_option_ratings r
set option_id = o.id
from public.decision_options o
where o.decision_id = r.decision_id and o.branch_id = r.branch_id and r.option_id is null;

update public.decision_option_marks m
set option_id = o.id
from public.decision_options o
where o.decision_id = m.decision_id and o.branch_id = m.branch_id and m.option_id is null;

-- Catalogue and web sources are append-only: their own triggers refuse an
-- update. These two backfills add the compatibility pointer only; they do not
-- change a cited snapshot, URL, excerpt or timestamp.
alter table public.option_catalogue_sources disable trigger option_catalogue_sources_snapshot;
update public.option_catalogue_sources s
set option_id = o.id
from public.decision_options o
where o.decision_id = s.decision_id and o.branch_id = s.branch_id and s.option_id is null;
alter table public.option_catalogue_sources enable trigger option_catalogue_sources_snapshot;

alter table public.option_web_sources disable trigger option_web_sources_append_only;
update public.option_web_sources s
set option_id = o.id
from public.decision_options o
where o.decision_id = s.decision_id and o.branch_id = s.branch_id and s.option_id is null;
alter table public.option_web_sources enable trigger option_web_sources_append_only;

-- Keep the new identity populated for options created by the existing UI.
-- These triggers are compatibility plumbing; they change no cited content and
-- do not alter what the decision page reads yet.
create function atlas.create_decision_option_from_link()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if new.linked_type = 'branch' then
    insert into public.decision_options
      (decision_id, branch_id, title, summary, position, created_by, created_at, updated_by, updated_at)
    select new.decision_id, b.id,
      left(coalesce(nullif(btrim(b.title), ''), nullif(btrim(b.name), ''), 'Option'), 200),
      left(coalesce(b.description, ''), 2000),
      coalesce((select max(o.position) from public.decision_options o where o.decision_id = new.decision_id), 0) + 1,
      new.created_by, new.created_at, new.created_by, new.created_at
    from public.branches b
    where b.id = new.linked_id
    on conflict (decision_id, branch_id) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function atlas.create_decision_option_from_link() from public, anon, authenticated;
create trigger decision_links_create_option
after insert on public.decision_links
for each row execute function atlas.create_decision_option_from_link();

create function atlas.fill_decision_option_id()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if new.option_id is null then
    select o.id into new.option_id
    from public.decision_options o
    where o.decision_id = new.decision_id and o.branch_id = new.branch_id
    limit 1;
  end if;
  return new;
end;
$$;
revoke all on function atlas.fill_decision_option_id() from public, anon, authenticated;
create trigger decision_option_ratings_fill_option before insert on public.decision_option_ratings
for each row execute function atlas.fill_decision_option_id();
create trigger decision_option_marks_fill_option before insert on public.decision_option_marks
for each row execute function atlas.fill_decision_option_id();
create trigger option_catalogue_sources_fill_option before insert on public.option_catalogue_sources
for each row execute function atlas.fill_decision_option_id();
create trigger option_web_sources_fill_option before insert on public.option_web_sources
for each row execute function atlas.fill_decision_option_id();

create function atlas.sync_decision_option_from_mark()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  update public.decision_options o
  set source = 'designer', agent = 'designer', drafted_at = new.drafted_at,
      draft_run_id = new.draft_run_id, edited_by = new.edited_by, edited_at = new.edited_at
  where o.decision_id = new.decision_id and o.branch_id = new.branch_id;
  return new;
end;
$$;
revoke all on function atlas.sync_decision_option_from_mark() from public, anon, authenticated;
create trigger decision_option_marks_sync_option
after insert or update on public.decision_option_marks
for each row execute function atlas.sync_decision_option_from_mark();


