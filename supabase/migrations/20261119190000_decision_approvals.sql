-- Phase C2 (Simon approved 2026-11-19, "One table, lenses are labels"): sign-off
-- on an exact frozen pack version. One insert-only row records that a named
-- Owner or Architect approved or declined one pack, speaking as one lens.
-- A lens is a label the person states they sign in, not a verified identity.
--
-- Rules, all enforced by the trigger below (never taken from the caller):
--   * the pack must be the LATEST version of its decision: a material edit is a
--     new frozen version and needs fresh sign-off, an old version cannot be signed;
--   * the person who froze the pack cannot sign it (separation of duties),
--     except in a personal "just me" organisation where nobody else exists;
--   * one verdict per person, per lens, per pack.
--
-- Advisor discipline (CLAUDE.md rule 9): NO SECURITY DEFINER function is added
-- (the signed-in-executable count stays at 60). RLS enabled and forced with a
-- select policy (members) and an insert policy (owner/architect, auth.uid()
-- in a select). The one trigger function is an invoker function with execute
-- revoked from everyone. The foreign key on pack_id is covered by the unique
-- constraint that leads with it; no extra index (it would be an unused-index
-- finding); org_id, decision_id and decided_by carry no foreign key (the
-- decision_packs precedent).

create table decision_approvals (
  id uuid primary key default gen_random_uuid(),
  -- org_id, decision_id, decided_by and decided_at are set by the trigger.
  org_id uuid not null,
  decision_id uuid not null,
  pack_id uuid not null references decision_packs (id),
  lens text not null check (lens in ('business_owner', 'architecture', 'delivery', 'security', 'data', 'funding')),
  verdict text not null check (verdict in ('approve', 'decline')),
  comment text not null default '' check (length(comment) <= 4000),
  decided_by uuid not null,
  decided_at timestamptz not null default now(),
  unique (pack_id, lens, decided_by)
);

comment on table decision_approvals is 'Phase C2: a named person approved or declined one exact frozen decision pack, as one lens (a stated capacity, not a verified role). Insert-only (owner/architect); never updated or deleted by application code.';

create function atlas.set_decision_approval_fields()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_pack decision_packs;
  v_latest integer;
  v_personal boolean;
begin
  -- Read through the caller's own RLS: a user from another organisation sees no pack.
  select * into v_pack from decision_packs where id = new.pack_id;
  if v_pack.id is null then
    raise exception 'sign_off_decision_pack: pack % not found', new.pack_id using errcode = '22023';
  end if;
  select max(version) into v_latest from decision_packs where decision_id = v_pack.decision_id;
  if v_pack.version <> v_latest then
    raise exception 'sign_off_decision_pack: version % is not the latest (version %); sign the latest pack', v_pack.version, v_latest using errcode = '22023';
  end if;
  select coalesce(o.is_personal, false) into v_personal from organisations o where o.id = v_pack.org_id;
  if v_pack.frozen_by = auth.uid() and v_personal is not true then
    raise exception 'sign_off_decision_pack: the person who froze a pack cannot sign it' using errcode = '42501';
  end if;
  new.org_id := v_pack.org_id;
  new.decision_id := v_pack.decision_id;
  new.decided_by := auth.uid();
  new.decided_at := now();
  return new;
end;
$$;

revoke all on function atlas.set_decision_approval_fields() from public, anon, authenticated;

create trigger decision_approvals_set_fields
  before insert on decision_approvals
  for each row execute function atlas.set_decision_approval_fields();

alter table decision_approvals enable row level security;
alter table decision_approvals force row level security;

create policy decision_approvals_select on decision_approvals
  for select to authenticated
  using (atlas.is_member(org_id));

create policy decision_approvals_insert on decision_approvals
  for insert to authenticated
  with check (atlas.has_role(org_id, 'owner', 'architect') is true and decided_by = (select auth.uid()));

revoke all on decision_approvals from public, anon, authenticated;
grant select, insert on decision_approvals to authenticated;
-- No update or delete policy or grant: a sign-off is never changed or removed.

-- atlas.delete_model: same body as 20261119140000_decision_packs.sql, plus clearing decision_approvals before decision_packs.
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
  delete from decision_approvals where decision_id in (select id from decisions where model_id = p_model_id); -- references decision_packs
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
