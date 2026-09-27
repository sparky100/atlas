-- atlas.delete_model (20260911040000_model_archive.sql, last touched
-- 20260911071500) was never updated as later sprints added new
-- model-scoped tables — decisions/decision_arguments/decision_links/
-- assumptions/evidence (20260913110000), review_verdicts (20260914060000),
-- notifications.merge_request_id (20260914060000), element_merges
-- (20260916050000), capture_jobs/capture_candidates (20260920195945),
-- duplicate_check_runs/duplicate_candidates/duplicate_dismissals
-- (20260924010000). Found live: deleting an archived model with any
-- capture history failed with "update or delete on table \"commits\"
-- violates foreign key constraint \"capture_candidates_promoted_commit_id_fkey\"".
-- The same gap exists for every other table this migration adds below —
-- none of them were reachable from a real capture run yet, so only the
-- capture one had actually been hit, but `review_verdicts`/`notifications`
-- (both reference `merge_requests`, no cascade) and `element_merges`/
-- `evidence` (reference `commits`/`sources`, no cascade) would fail the
-- identical way for a model with real review or merge history.
--
-- New delete order, topologically valid against every FK below (verified
-- against each table's own migration, not assumed):
--   notifications (merge_request_id) -> merge_requests
--   comments -> cascades comment_mentions, notifications (comment_id)
--   review_verdicts -> merge_requests
--   decision_arguments, decision_links -> decisions
--   duplicate_candidates -> duplicate_check_runs
--   decisions -> branches (self-ref nulled first, same treatment
--     comments.parent_comment_id already gets — no CHECK constraint ties
--     to it, so nulling is safe, unlike the deltas/commits/branches cycle
--     20260911071500's own comment explains nulling could never work for)
--   element_merges -> evidence, commits
--   evidence -> sources
--   resolved_conflicts -> deltas
--   merge_requests -> commits, branches
--   views -> branches (cascades view_layouts, view_annotations)
--   facts -> deltas, sources
--   tags -> commits
--   elements_head, relationships_head -> deltas
--   aliases -> sources
--   deltas -> sources, commits (self-ref already deferred)
--   sources -> capture_jobs (capture_job_id) — sources must precede
--     capture_jobs, the reverse of every other direction sources
--     participates in
--   capture_jobs -> branches (self-ref nulled first, same reasoning as
--     decisions above); cascades capture_candidates, which itself
--     references commits (promoted_commit_id) — the exact FK this
--     migration was written to fix
--   commits, branches -> as before (deferred cycle unchanged)

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

  -- Every FK this cycle runs into (deltas<->deltas, commits<->commits,
  -- branches->commits, commits->branches) is deferrable — deferred for the
  -- rest of this transaction, so the delete order below only has to
  -- satisfy the *non*-deferrable FKs, never the self-/cross-referencing
  -- ones, and no column in this cycle is ever set to null.
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

  delete from notifications where merge_request_id in (select id from merge_requests where model_id = p_model_id);
  delete from comments where model_id = p_model_id; -- cascades comment_mentions, and any notifications by comment_id
  delete from review_verdicts where model_id = p_model_id; -- references merge_requests
  delete from decision_arguments where decision_id in (select id from decisions where model_id = p_model_id);
  delete from decision_links where decision_id in (select id from decisions where model_id = p_model_id);
  delete from duplicate_candidates where model_id = p_model_id; -- references duplicate_check_runs
  delete from duplicate_check_runs where model_id = p_model_id;
  delete from duplicate_dismissals where model_id = p_model_id;
  delete from assumptions where model_id = p_model_id;
  delete from decisions where model_id = p_model_id; -- references branches; self-ref already nulled
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
  delete from commits where model_id = p_model_id; -- self-ref and branches' ref both deferred; deltas/capture_candidates/element_merges/tags/merge_requests already gone
  delete from branches where model_id = p_model_id; -- ref to commits deferred; every other branch_id FK already gone above
  delete from models where id = p_model_id;

  return jsonb_build_object('status', 'deleted');
end;
$$;

revoke all on function atlas.delete_model from public;
grant execute on function atlas.delete_model to authenticated;
