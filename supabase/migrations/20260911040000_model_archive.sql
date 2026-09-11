-- Sprint 7j item 1: model settings' Archive/Restore/Delete (ADR-009
-- amendment — see docs/ADR-000-foundations.md's appended paragraph).
--
-- Archive is soft: `archived_at` only, nothing cascades, an owner/architect
-- can archive or restore. Delete is hard, owner-only, and only once
-- archived — see atlas.delete_model's own comment for why it can't just be
-- `delete from models` with cascading FKs: the real FK graph from `models`
-- downward is not a clean tree (several self-referencing and cross-table
-- FKs with no ON DELETE clause of their own), verified table-by-table
-- against every migration in this directory before writing this, not
-- assumed.

alter table models add column archived_at timestamptz;

comment on column models.archived_at is 'Sprint 7j: set by atlas.archive_model, cleared by atlas.restore_model. Hidden from ordinary lists (src/db/models.ts''s listModelsForOrg filters it out) but still directly openable, read-only, by anyone who could already see the model — this column carries no RLS implications of its own.';

-- `models_update`'s own RLS (20260906071300_models.sql) only checks role,
-- not which columns — a blanket `grant update on models` would let an
-- architect flip `archived_at` directly (bypassing the RPCs' own, stricter
-- rules: restore is owner-only, narrower than "update" in general) or an
-- owner delete-bypass the "only when archived" gate below by clearing it
-- mid-flight. Same column-restriction convention `branches` already uses
-- (`grant update (title, shared_for_review)`) — `archived_at` is
-- deliberately left out, reachable only through the two security-definer
-- functions below.
revoke update on models from authenticated;
grant update (name, slug, description) on models to authenticated;

-- Same reasoning for delete: `models_delete`'s RLS (owner-only) says who,
-- not "only when archived" or "cascade correctly first" — a raw client
-- delete would either fail on the first FK it hits (most models, which
-- have real child rows) or, for a model with none yet, succeed without
-- ever checking `archived_at` at all. Routed exclusively through
-- `atlas.delete_model` instead.
revoke delete on models from authenticated;

-- ---------------------------------------------------------------------------
-- atlas.archive_model / atlas.restore_model
-- ---------------------------------------------------------------------------

create or replace function atlas.archive_model(p_model_id uuid)
returns models
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id uuid;
  v_row models;
begin
  select org_id into v_org_id from models where id = p_model_id;
  if v_org_id is null then
    raise exception 'archive_model: model % not found', p_model_id using errcode = '22023';
  end if;
  if atlas.has_role(v_org_id, 'owner', 'architect') is not true then
    raise exception 'archive_model: insufficient role in this organisation' using errcode = '42501';
  end if;

  update models set archived_at = now() where id = p_model_id
    returning * into v_row;
  return v_row;
end;
$$;

revoke all on function atlas.archive_model from public;
grant execute on function atlas.archive_model to authenticated;

-- Restore is narrower than archive: owners only, per the prompt's own
-- "Restore for owners" wording (an architect can archive but not undo it).
create or replace function atlas.restore_model(p_model_id uuid)
returns models
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id uuid;
  v_row models;
begin
  select org_id into v_org_id from models where id = p_model_id;
  if v_org_id is null then
    raise exception 'restore_model: model % not found', p_model_id using errcode = '22023';
  end if;
  if atlas.has_role(v_org_id, 'owner') is not true then
    raise exception 'restore_model: only an owner may restore an archived model' using errcode = '42501';
  end if;

  update models set archived_at = null where id = p_model_id
    returning * into v_row;
  return v_row;
end;
$$;

revoke all on function atlas.restore_model from public;
grant execute on function atlas.restore_model to authenticated;

-- ---------------------------------------------------------------------------
-- atlas.delete_model: owner-only, only when archived, cascades through
-- every org-scoped table this model's rows touch.
--
-- Why this can't be a plain `delete from models where id = ...` relying on
-- FK cascades: of every table with a `model_id` FK to `models` (checked via
-- `grep -rn "references models" supabase/migrations/*.sql` against this
-- exact migration set), only `branches` itself declares
-- `on delete cascade` from `models`. Everything else — commits, deltas,
-- tags, sources, aliases, facts, views, merge_requests, resolved_conflicts,
-- comments — does not, and several of those (deltas.previous_delta_id,
-- commits.parent_commit_id/merged_branch_head_commit_id) are
-- self-referencing, and elements_head/relationships_head.exists_delta_id
-- requires the referenced delta to still exist. None of these constraints
-- are DEFERRABLE. So a plain cascading delete from `models` would fail
-- (FK violations on commits.branch_id, deltas.commit_id, etc.) or, worse,
-- silently leave orphaned rows behind depending on statement order — this
-- function instead (a) nulls every self-referencing/cross-referencing
-- column that would otherwise create an ordering cycle, then (b) deletes
-- every table in dependency order, leaves-first, verified against the real
-- FK graph rather than assumed from the ORM-shaped mental model of "it all
-- just cascades from the top".
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

  -- Break every self-referencing / cross-table FK cycle before deleting
  -- anything — see this function's own module comment.
  update deltas set previous_delta_id = null where model_id = p_model_id;
  update commits set parent_commit_id = null, merged_branch_head_commit_id = null where model_id = p_model_id;
  update branches set base_commit_id = null, head_commit_id = null where model_id = p_model_id;
  update comments set parent_comment_id = null where model_id = p_model_id;

  -- Leaves first, in the order each table's own outgoing FKs require.
  delete from comments where model_id = p_model_id; -- cascades comment_mentions, notifications
  delete from resolved_conflicts where model_id = p_model_id; -- references deltas
  delete from merge_requests where model_id = p_model_id; -- references commits, branches
  delete from views where model_id = p_model_id; -- cascades view_layouts, view_annotations
  delete from facts where model_id = p_model_id; -- references deltas, sources — deleted explicitly, not via commits' own cascade of facts (ordering: deltas must survive until elements_head/relationships_head are gone, below)
  delete from tags where model_id = p_model_id; -- references commits
  delete from elements_head where model_id = p_model_id; -- references deltas via exists_delta_id
  delete from relationships_head where model_id = p_model_id; -- references deltas via exists_delta_id
  delete from deltas where model_id = p_model_id; -- self-ref already nulled; now nothing references deltas
  delete from commits where model_id = p_model_id; -- self-ref and branches' refs already nulled; deltas already gone
  delete from aliases where model_id = p_model_id; -- references sources
  delete from sources where model_id = p_model_id; -- nothing references sources now
  delete from branches where model_id = p_model_id; -- commits/views/merge_requests/comments no longer reference it
  delete from models where id = p_model_id;

  return jsonb_build_object('status', 'deleted');
end;
$$;

revoke all on function atlas.delete_model from public;
grant execute on function atlas.delete_model to authenticated;
