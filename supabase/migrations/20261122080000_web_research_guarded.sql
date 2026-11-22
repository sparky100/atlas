-- D4 guarded Researcher: a default-off organisation switch, an append-only
-- egress record, and the person's check on a saved web source.
--
-- The Designer never searches. A person starts research explicitly, approves
-- the exact query, and the server-side research function is the only caller
-- allowed to ask llm-proxy for a web search. This migration adds the switch
-- and the record; the function and UI follow.

alter table public.organisations
  add column ai_web_search_enabled boolean not null default false;

comment on column public.organisations.ai_web_search_enabled is 'D4: an owner must switch this on before anyone can use the guarded web Researcher. Default off.';
grant update (ai_web_search_enabled) on public.organisations to authenticated;

-- A saved web page now carries the assertion it supports, who checked it and
-- when. All three are set together by the Researcher UI; the old rows (if any)
-- remain valid with all three null.
alter table public.option_web_sources
  add column assertion text check (assertion is null or length(btrim(assertion)) between 1 and 500),
  add column checked_by uuid,
  add column checked_at timestamptz,
  add constraint option_web_sources_checked_together check (
    (assertion is null) = (checked_by is null)
    and (checked_by is null) = (checked_at is null)
  );

comment on column public.option_web_sources.assertion is 'D4: the claim this page was checked to support. Null for a saved page from the earlier Designer path.';
comment on column public.option_web_sources.checked_by is 'D4: the person who checked that the page supports the assertion.';
comment on column public.option_web_sources.checked_at is 'D4: when that check was made.';

-- A check is the caller's own: an insert may leave the check empty, but it
-- may not attribute a check to someone else.
alter policy option_web_sources_insert on public.option_web_sources
  with check (
    cited_by = (select auth.uid())
    and (checked_by is null or checked_by = (select auth.uid()))
    and exists (
      select 1 from public.decisions d
      where d.id = option_web_sources.decision_id
        and d.status = 'proposed'
        and atlas.has_role(d.org_id, 'owner', 'architect', 'contributor')
    )
    and exists (
      select 1 from public.decision_links l
      where l.decision_id = option_web_sources.decision_id
        and l.linked_type = 'branch'
        and l.linked_id = option_web_sources.branch_id
    )
  );

-- The check time is server time, like `cited_at`; the UI's value only lets
-- the all-or-none check pass before this trigger runs.
create or replace function atlas.guard_option_web_sources_append_only()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'option web sources are insert-only' using errcode = '23514';
  end if;
  new.cited_at := now();
  if new.checked_by is not null then
    new.checked_at := now();
  end if;
  return new;
end;
$$;

create table public.web_research_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id),
  decision_id uuid not null references public.decisions (id),
  branch_id uuid not null,
  requested_by uuid not null,
  query text not null check (length(btrim(query)) between 3 and 300),
  status text not null check (status in ('ok', 'error')),
  result_count integer not null default 0 check (result_count between 0 and 20),
  urls jsonb not null default '[]'::jsonb check (jsonb_typeof(urls) = 'array'),
  error text check (error is null or length(error) <= 500),
  created_at timestamptz not null default now()
);

comment on table public.web_research_requests is 'D4: an append-only record of each explicitly approved public-web search: who asked, for which org/decision/option, the exact query, and the URLs returned.';
create index web_research_requests_org_created_idx on public.web_research_requests (org_id, created_at desc);
create index web_research_requests_decision_created_idx on public.web_research_requests (decision_id, created_at desc);

alter table public.web_research_requests enable row level security;
alter table public.web_research_requests force row level security;
revoke all on public.web_research_requests from public, anon, authenticated;
grant select, insert on public.web_research_requests to authenticated;

create policy web_research_requests_select on public.web_research_requests
  for select to authenticated
  using (atlas.is_member(org_id));

create policy web_research_requests_insert on public.web_research_requests
  for insert to authenticated
  with check (
    requested_by = (select auth.uid())
    and exists (
      select 1 from public.decisions d
      where d.id = web_research_requests.decision_id
        and d.org_id = web_research_requests.org_id
        and d.status = 'proposed'
        and atlas.has_role(d.org_id, 'owner', 'architect', 'contributor')
    )
    and exists (
      select 1 from public.decision_links l
      where l.decision_id = web_research_requests.decision_id
        and l.linked_type = 'branch'
        and l.linked_id = web_research_requests.branch_id
    )
  );

-- Append-only even for the service role: an egress record is evidence of what
-- left the building, not a mutable note.
create function atlas.guard_web_research_requests_append_only()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'web research requests are append-only' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function atlas.guard_web_research_requests_append_only() from public, anon, authenticated;
create trigger web_research_requests_append_only before insert or update or delete on public.web_research_requests
for each row execute function atlas.guard_web_research_requests_append_only();
