-- Phase 2a: a person can record what a search or catalogue lookup could not
-- find, on the option or the decision. It is a short note for the next reader,
-- not evidence, not a catalogue claim and never a write to the live model.
--
-- Insert-only content: the body cannot be edited. The person who recorded it
-- (or an owner/architect) may remove it while the decision is still proposed,
-- so a mistake is not permanent. The option pointer is filled from the
-- decision and branch by the same compatibility trigger the other source
-- tables use.
create table decision_gaps (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references decisions (id),
  branch_id uuid,
  option_id uuid references decision_options (id),
  origin text not null default 'manual' check (origin in ('research', 'catalogue', 'manual')),
  body text not null check (length(btrim(body)) between 1 and 500),
  created_by uuid not null,
  created_at timestamptz not null default now()
);

comment on table decision_gaps is 'Phase 2a: what a research search or catalogue lookup could not find, recorded on a decision option or the decision. A note, not evidence.';

create index decision_gaps_decision_created_idx on decision_gaps (decision_id, created_at);
create index decision_gaps_option_idx on decision_gaps (option_id) where option_id is not null;

alter table decision_gaps enable row level security;
alter table decision_gaps force row level security;

create policy decision_gaps_select on decision_gaps
  for select to authenticated
  using (exists (
    select 1 from decisions d
    where d.id = decision_gaps.decision_id and atlas.is_member(d.org_id)
  ));

create policy decision_gaps_insert on decision_gaps
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and exists (
      select 1 from decisions d
      where d.id = decision_gaps.decision_id
        and d.status = 'proposed'
        and atlas.has_role(d.org_id, 'owner', 'architect', 'contributor')
    )
    and (
      decision_gaps.branch_id is null
      or exists (
        select 1 from decision_links dl
        where dl.decision_id = decision_gaps.decision_id
          and dl.linked_type = 'branch'
          and dl.linked_id = decision_gaps.branch_id
      )
    )
    and (
      decision_gaps.option_id is null
      or exists (
        select 1 from decision_options o
        where o.id = decision_gaps.option_id and o.decision_id = decision_gaps.decision_id
      )
    )
  );

create policy decision_gaps_delete on decision_gaps
  for delete to authenticated
  using (exists (
    select 1 from decisions d
    where d.id = decision_gaps.decision_id
      and d.status = 'proposed'
      and (
        decision_gaps.created_by = (select auth.uid())
        or atlas.has_role(d.org_id, 'owner', 'architect')
      )
  ));

revoke all on decision_gaps from public, anon, authenticated;
grant select, insert, delete on decision_gaps to authenticated;

create trigger decision_gaps_fill_option before insert on decision_gaps
for each row execute function atlas.fill_decision_option_id();

-- No edits: remove and record again instead. This keeps a gap honest about
-- what was recorded and when, while still letting a mistake be removed.
create function atlas.guard_decision_gaps_no_update()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'decision gaps cannot be edited; remove and record again' using errcode = '23514';
end;
$$;
revoke all on function atlas.guard_decision_gaps_no_update() from public, anon, authenticated;
create trigger decision_gaps_no_update before update on decision_gaps
for each row execute function atlas.guard_decision_gaps_no_update();
