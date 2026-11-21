-- D4, PR 1: a web page saved as evidence behind a decision's option.
--
-- This is deliberately separate from the reviewed catalogue. A catalogue
-- claim has a named reviewer and a dated source; a web page is evidence a
-- person or agent found, and is shown as unreviewed. Saving one never
-- approves procurement or changes the live model.
--
-- Append-only: select and insert only, no update or delete policy or grant.
-- The URL is the identity within an option, so a retry cannot duplicate it.
--
-- No org_id and no foreign key on branch_id: the organisation comes from the
-- decision, and the branch must be a branch-typed link on that decision. The
-- primary key leads with decision_id, so a decision's sources read in one
-- indexed scan.

create table public.option_web_sources (
  decision_id uuid not null references public.decisions (id),
  branch_id uuid not null,
  url text not null check (length(url) between 10 and 2000 and url ~ '^https://[^[:space:]]+$'),
  title text not null check (length(btrim(title)) between 1 and 200),
  publisher text check (publisher is null or length(btrim(publisher)) between 1 and 200),
  excerpt text check (excerpt is null or length(btrim(excerpt)) between 1 and 1000),
  retrieved_at timestamptz not null,
  cited_by uuid not null,
  cited_at timestamptz not null default now(),
  primary key (decision_id, branch_id, url)
);

comment on table public.option_web_sources is 'D4: web pages saved as unreviewed evidence behind a decision option. Append-only; the URL is the identity within an option.';

alter table public.option_web_sources enable row level security;
alter table public.option_web_sources force row level security;

revoke all on public.option_web_sources from public, anon, authenticated;
grant select, insert on public.option_web_sources to authenticated, service_role;

create policy option_web_sources_select on public.option_web_sources
  for select to authenticated
  using (
    exists (
      select 1 from public.decisions d
      where d.id = option_web_sources.decision_id
        and atlas.is_member(d.org_id)
    )
  );

create policy option_web_sources_insert on public.option_web_sources
  for insert to authenticated
  with check (
    cited_by = (select auth.uid())
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

-- Insert-only even for the service role: a saved page is a record of what was
-- read, not a mutable note. The server sets the citation time.
create function atlas.guard_option_web_sources_append_only()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'option web sources are insert-only' using errcode = '23514';
  end if;
  new.cited_at := now();
  return new;
end;
$$;
revoke all on function atlas.guard_option_web_sources_append_only() from public, anon, authenticated;
create trigger option_web_sources_append_only before insert or update or delete on public.option_web_sources
for each row execute function atlas.guard_option_web_sources_append_only();
