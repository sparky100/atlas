-- Phase B3 (Simon approved 2026-11-19): a frozen, versioned decision pack.
-- A pack is the written-up decision (the ADR text: need, options, evidence,
-- reasons, what would make us reconsider) exactly as the person saw it when
-- they froze it, plus the version of the live model it was written against.
-- Insert-only: a later edit to the decision never changes a pack, a material
-- change is a new version (1, 2, 3 ...). No update or delete policy or grant
-- exists, so no client can change or remove a pack.
--
-- Advisor discipline (CLAUDE.md rule 9): this adds NO SECURITY DEFINER
-- function, so the "signed-in users can execute SECURITY DEFINER" count stays
-- at 60. RLS is enabled and forced with a select and an insert policy; the
-- insert policy is owner/architect only and `auth.uid()` is in a select; the
-- one trigger function is an invoker function with all execute revoked; the
-- foreign key on decision_id is covered by unique (decision_id, version);
-- the audit columns and org_id carry no foreign key (principles/goals precedent).

create table decision_packs (
  id uuid primary key default gen_random_uuid(),
  -- org_id, version, decision_status and frozen_by are set by the trigger
  -- below from the decision itself, never taken from the caller.
  org_id uuid not null,
  decision_id uuid not null references decisions (id),
  version integer not null check (version >= 1),
  -- The decision's status when frozen (proposed / accepted / rejected ...).
  decision_status text not null,
  -- The head commit of the live model the pack was written against. No foreign
  -- key: a commit is history and is never touched by this table.
  commit_id uuid,
  -- The ADR markdown exactly as exported at freeze time.
  body_markdown text not null check (length(btrim(body_markdown)) > 0 and length(body_markdown) <= 200000),
  frozen_by uuid not null,
  frozen_at timestamptz not null default now(),
  unique (decision_id, version)
);

comment on table decision_packs is 'Phase B3: a frozen, versioned copy of a decision write-up. Insert-only (owner/architect); never updated or deleted by application code. A material change is a new version.';

create function atlas.set_decision_pack_fields()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_decision decisions;
begin
  -- Serialise two people freezing the same decision at once: versions 1 and 2.
  perform pg_advisory_xact_lock(hashtextextended(new.decision_id::text, 0));
  select * into v_decision from decisions where id = new.decision_id;
  if v_decision.id is null then
    raise exception 'freeze_decision_pack: decision % not found', new.decision_id using errcode = '22023';
  end if;
  new.org_id := v_decision.org_id;
  new.decision_status := v_decision.status;
  new.frozen_by := auth.uid();
  new.frozen_at := now();
  select coalesce(max(version), 0) + 1 into new.version from decision_packs where decision_id = new.decision_id;
  return new;
end;
$$;

revoke all on function atlas.set_decision_pack_fields() from public, anon, authenticated;

create trigger decision_packs_set_fields
  before insert on decision_packs
  for each row execute function atlas.set_decision_pack_fields();

alter table decision_packs enable row level security;
alter table decision_packs force row level security;

create policy decision_packs_select on decision_packs
  for select to authenticated
  using (atlas.is_member(org_id));

create policy decision_packs_insert on decision_packs
  for insert to authenticated
  with check (atlas.has_role(org_id, 'owner', 'architect') is true and frozen_by = (select auth.uid()));

revoke all on decision_packs from public, anon, authenticated;
grant select, insert on decision_packs to authenticated;
-- No update or delete policy or grant: a pack is never changed or removed.

-- atlas.delete_model: same body as 20261117200000_goals.sql, plus clearing decision_packs before decisions.
create or replace function atlas.delete_model(p_model_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id uuid;
  v_archived_at timestamptz;
begin
  select org_id, archived_at into v_org_id, v_archived_at from models where id = p_model_id for update;
  if v_org_id is null then
    return jsonb_build_object('status', 'not_found');
  end if;
  if atlas.has_role(v_org_id, 'owner') is not true then
    raise exception 'delete_model: only an owner may delete a model' using errcode = '42501';
  end if;
  if v_archived_at is null then
    return jsonb_build_object('status', 'not_archived');
  end if;

  set constraints
    deltas_previous_delta_id_fkey,
    commits_parent_commit_id_fkey,
    commits_merged_branch_head_commit_id_fkey,
    branches_base_commit_id_fkey,
    branches_head_commit_id_fkey,
    commits_branch_id_fkey
    deferred;

  update comments set parent_comment_id = null where model_id = p_model_id;
  update decisions set superseded_decision_id = null where model_id = p_model_id;
  update capture_jobs set reimport_of_job_id = null where model_id = p_model_id;

  delete from report_snapshots where model_id = p_model_id; -- references saved_reports, branches, commits
  delete from dashboard_tiles where dashboard_id in (select id from dashboards where model_id = p_model_id); -- references dashboards, saved_reports
  delete from dashboards where model_id = p_model_id;
  delete from saved_reports where model_id = p_model_id;
  delete from notifications where merge_request_id in (select id from merge_requests where model_id = p_model_id);
  delete from comments where model_id = p_model_id; -- cascades comment_mentions, and any notifications by comment_id
  delete from review_verdicts where model_id = p_model_id; -- references merge_requests
  delete from decision_packs where decision_id in (select id from decisions where model_id = p_model_id); -- references decisions
  delete from decision_arguments where decision_id in (select id from decisions where model_id = p_model_id);
  delete from decision_links where decision_id in (select id from decisions where model_id = p_model_id);
  delete from decision_option_ratings where decision_id in (select id from decisions where model_id = p_model_id); -- references decisions, branches
  delete from project_links where project_id in (select id from projects where model_id = p_model_id); -- references projects
  delete from decision_principles where decision_id in (select id from decisions where model_id = p_model_id); -- references decisions
  delete from principles where model_id = p_model_id; -- nothing references it once decision_principles is gone
  delete from goal_capabilities where goal_id in (select id from goals where model_id = p_model_id); -- references goals
  delete from goals where model_id = p_model_id; -- nothing references it once goal_capabilities is gone
  delete from duplicate_candidates where model_id = p_model_id; -- references duplicate_check_runs
  delete from duplicate_check_runs where model_id = p_model_id;
  delete from duplicate_dismissals where model_id = p_model_id;
  delete from assumptions where model_id = p_model_id;
  delete from decisions where model_id = p_model_id; -- references branches, projects; self-ref already nulled
  delete from element_merges where model_id = p_model_id; -- references evidence, commits
  delete from evidence where model_id = p_model_id; -- references sources
  delete from resolved_conflicts where model_id = p_model_id; -- references deltas
  delete from merge_requests where model_id = p_model_id; -- references commits, branches
  delete from views where model_id = p_model_id; -- cascades view_layouts, view_annotations
  delete from facts where model_id = p_model_id; -- references deltas, sources
  delete from tags where model_id = p_model_id; -- references commits
  delete from elements_head where model_id = p_model_id; -- references deltas via exists_delta_id
  delete from relationships_head where model_id = p_model_id; -- references deltas via exists_delta_id
  delete from aliases where model_id = p_model_id; -- references sources
  delete from deltas where model_id = p_model_id; -- self-ref deferred; commit_id/source_id -> commits/sources still required below
  delete from sources where model_id = p_model_id; -- deltas/aliases/evidence/facts referencing it already gone; still referenced by capture_jobs below
  delete from capture_jobs where model_id = p_model_id; -- cascades capture_candidates; self-ref already nulled; references branches
  delete from commits where model_id = p_model_id; -- self-ref and branches' ref both deferred
  delete from branches where model_id = p_model_id; -- references projects; ref to commits deferred
  delete from projects where model_id = p_model_id; -- decisions/branches/project_links referencing it already gone
  delete from models where id = p_model_id;

  return jsonb_build_object('status', 'deleted');
end;
$$;

revoke all on function atlas.delete_model from public;
grant execute on function atlas.delete_model to authenticated;
