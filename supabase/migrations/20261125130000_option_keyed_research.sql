-- Item 2 of the 25 Nov review (proposals/PROPOSAL-research-candidate-option.md,
-- Simon chose 2026-11-25): research, saved web pages and reviewed catalogue
-- products belong to the candidate option, not to a delivery branch, so a
-- person can research an option before anyone presses "Work on this option".
--
-- Same shape as 20261123130000_option_keyed_ratings.sql: `option_id` becomes
-- the key and the authority for "is this one of this decision's options";
-- `branch_id` becomes optional and, when set, must be that option's branch.
-- Existing rows already carry `option_id` (20261123090000 backfill and the
-- fill trigger), so nothing is rewritten here except web_research_requests,
-- which gains the column now.
--
-- Who may do what is unchanged: insert still needs an owner, architect or
-- contributor on a proposed decision, and all three tables stay append-only.
--
-- No function is added or changed, so this migration adds no advisor finding.

-- Saved web pages ------------------------------------------------------------

alter table public.option_web_sources alter column option_id set not null;
alter table public.option_web_sources drop constraint option_web_sources_pkey;
alter table public.option_web_sources alter column branch_id drop not null;
alter table public.option_web_sources add primary key (decision_id, option_id, url);

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
      select 1 from public.decision_options o
      where o.id = option_web_sources.option_id
        and o.decision_id = option_web_sources.decision_id
        and (option_web_sources.branch_id is null or o.branch_id = option_web_sources.branch_id)
    )
  );

-- Reviewed catalogue products ------------------------------------------------

alter table public.option_catalogue_sources alter column option_id set not null;
alter table public.option_catalogue_sources drop constraint option_catalogue_sources_pkey;
alter table public.option_catalogue_sources alter column branch_id drop not null;
alter table public.option_catalogue_sources
  add primary key (decision_id, option_id, catalogue_sector, catalogue_version, entry_code);

alter policy option_catalogue_sources_insert on public.option_catalogue_sources
  with check (
    cited_by = (select auth.uid())
    and exists (select 1 from public.decisions d where d.id = option_catalogue_sources.decision_id
      and d.status = 'proposed'
      and atlas.has_role(d.org_id, 'owner', 'architect', 'contributor'))
    and exists (select 1 from public.decision_options o
      where o.id = option_catalogue_sources.option_id
        and o.decision_id = option_catalogue_sources.decision_id
        and (option_catalogue_sources.branch_id is null or o.branch_id = option_catalogue_sources.branch_id))
  );

-- The egress record ----------------------------------------------------------

alter table public.web_research_requests add column option_id uuid references public.decision_options (id);

-- Append-only even for the service role; this one-off backfill adds the
-- pointer only and changes no query, URL or timestamp.
alter table public.web_research_requests disable trigger web_research_requests_append_only;
update public.web_research_requests r
set option_id = o.id
from public.decision_options o
where o.decision_id = r.decision_id and o.branch_id = r.branch_id and r.option_id is null;
alter table public.web_research_requests enable trigger web_research_requests_append_only;

alter table public.web_research_requests alter column option_id set not null;
alter table public.web_research_requests alter column branch_id drop not null;
create index web_research_requests_option_idx on public.web_research_requests (option_id);

-- The same compatibility fill the other option-keyed tables already have
-- (20261123090000), reusing its existing function: a caller that still sends
-- only a branch (the research function until it is redeployed) gets that
-- branch's option, so no search goes unrecorded.
create trigger web_research_requests_fill_option before insert on public.web_research_requests
for each row execute function atlas.fill_decision_option_id();

comment on column public.web_research_requests.option_id is 'The candidate option the search was for. The option, not a branch, is the authority; branch_id is set only when the option already had a change.';

alter policy web_research_requests_insert on public.web_research_requests
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
      select 1 from public.decision_options o
      where o.id = web_research_requests.option_id
        and o.decision_id = web_research_requests.decision_id
        and (web_research_requests.branch_id is null or o.branch_id = web_research_requests.branch_id)
    )
  );
