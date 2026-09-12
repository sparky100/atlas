-- Fixes atlas.delete_model (20260911040000_model_archive.sql). Found live
-- while writing this session's own bug-fix Playwright run: deleting an
-- archived model always failed, first with "head_commit_id must advance
-- to a commit on this branch whose parent is the branch's current head"
-- (guard_branch_head_advance, 20260906071800_branch_head_advance.sql,
-- rejecting `update branches set base_commit_id = null, head_commit_id =
-- null ...`), and — once that was fixed by reordering the deletes instead
-- — a second, deeper one behind it: `update deltas set previous_delta_id
-- = null ...` violates `deltas_check8` (`(kind IN ('element_create',
-- 'relationship_create')) = (previous_delta_id IS NULL)`) for every
-- non-create delta, and the equivalent `update commits set
-- merged_branch_head_commit_id = null ...` would likewise violate
-- commits' own `(kind = 'merge') = (merged_branch_head_commit_id IS NOT
-- NULL)` check for any merge commit. `atlas.delete_model` has therefore
-- never actually succeeded on any model with real history — every one of
-- these "null the self-reference first" attempts was going to fail on
-- some CHECK constraint or NOT NULL column no matter the order, because
-- nulling isn't actually necessary: `commits.branch_id`'s own FK back to
-- `branches` is already `deferrable initially deferred`
-- (20260906220000_main_always_has_head.sql:110) for exactly this reason,
-- and the other four self-/cross-referencing FKs this function's cycle
-- runs into were simply never given the same treatment.
--
-- Fix: make every remaining FK in this cycle deferrable too, and delete
-- rows outright instead of nulling anything — a deferred FK is only
-- checked at transaction commit (the end of this whole function call),
-- by which point every row on both sides of each of these is already
-- gone, so there is nothing left to violate. CHECK constraints (unlike
-- FKs) are never deferrable in Postgres, which is exactly why the
-- original nulling approach could never have worked — this sidesteps
-- them entirely by not writing to those columns at all. Confirmed by
-- actually running e2e/model-settings-archive.spec.ts's and
-- src/db/modelArchive.integration.test.ts's own delete tests against a
-- real local Supabase, not just typechecked.

alter table deltas drop constraint deltas_previous_delta_id_fkey;
alter table deltas add constraint deltas_previous_delta_id_fkey foreign key (previous_delta_id) references deltas (id) deferrable initially deferred;

alter table commits drop constraint commits_parent_commit_id_fkey;
alter table commits add constraint commits_parent_commit_id_fkey foreign key (parent_commit_id) references commits (id) deferrable initially deferred;

alter table commits drop constraint commits_merged_branch_head_commit_id_fkey;
alter table commits add constraint commits_merged_branch_head_commit_id_fkey foreign key (merged_branch_head_commit_id) references commits (id) deferrable initially deferred;

alter table branches drop constraint branches_base_commit_id_fkey;
alter table branches add constraint branches_base_commit_id_fkey foreign key (base_commit_id) references commits (id) deferrable initially deferred;

alter table branches drop constraint branches_head_commit_id_fkey;
alter table branches add constraint branches_head_commit_id_fkey foreign key (head_commit_id) references commits (id) deferrable initially deferred;

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
  -- branches->commits, commits->branches) is now deferrable — deferred
  -- for the rest of this transaction, so the delete order below only has
  -- to satisfy the *non*-deferrable FKs (elements_head/relationships_head/
  -- facts -> deltas; deltas/tags -> commits; commits/comments/views/
  -- merge_requests -> branches), never the self-/cross-referencing ones,
  -- and no column here is ever set to null.
  set constraints
    deltas_previous_delta_id_fkey,
    commits_parent_commit_id_fkey,
    commits_merged_branch_head_commit_id_fkey,
    branches_base_commit_id_fkey,
    branches_head_commit_id_fkey,
    commits_branch_id_fkey
    deferred;

  update comments set parent_comment_id = null where model_id = p_model_id;

  -- Leaves first, in the order each table's own non-deferred outgoing FKs require.
  delete from comments where model_id = p_model_id; -- cascades comment_mentions, notifications
  delete from resolved_conflicts where model_id = p_model_id; -- references deltas
  delete from merge_requests where model_id = p_model_id; -- references commits, branches
  delete from views where model_id = p_model_id; -- cascades view_layouts, view_annotations
  delete from facts where model_id = p_model_id; -- references deltas, sources
  delete from tags where model_id = p_model_id; -- references commits
  delete from elements_head where model_id = p_model_id; -- references deltas via exists_delta_id
  delete from relationships_head where model_id = p_model_id; -- references deltas via exists_delta_id
  delete from deltas where model_id = p_model_id; -- self-ref deferred; commit_id -> commits still required below
  delete from commits where model_id = p_model_id; -- self-ref and branches' ref both deferred; deltas already gone
  delete from branches where model_id = p_model_id; -- ref to commits deferred; every other branch_id FK already gone above
  delete from aliases where model_id = p_model_id; -- references sources
  delete from sources where model_id = p_model_id; -- nothing references sources now
  delete from models where id = p_model_id;

  return jsonb_build_object('status', 'deleted');
end;
$$;
