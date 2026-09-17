-- E7 (docs/prompts/atlas-prompt-pack.md): `atlas.merge_elements` — a
-- reversible identity merge (ADR-019, docs/ADR-000-foundations.md).
-- `element_merges` itself was already fully specified (SPEC-data-model.md
-- §3.6) but never migrated; this is that migration, plus the one RPC the
-- client can't safely do with a plain insert: `merged_id` aliases are
-- deliberately blocked from `aliases_insert`'s own RLS
-- (`20260906071500_sources_and_aliases.sql`) for everyone but this path.
--
-- Design note (not in SPEC's own text, decided here): the actual retract-
-- and-repoint commit is an ordinary `manual` commit through the existing
-- `atlas.commit_deltas`/`commitToBranch` path — merging two elements is,
-- mechanically, exactly the edit a person would make by hand (retract one,
-- re-point its relationships, re-parent its children), so it needs no new
-- commit kind and inherits the exact same role/branch-status checks every
-- other edit already goes through. This migration adds only the one thing
-- a plain commit can't also do atomically: recording `element_merges` and
-- the `merged_id` alias alongside it. `record_element_merge` takes an
-- already-written commit's id (verified to be a `manual` commit that
-- exists on this model) rather than building the commit itself — the two
-- extra rows are best-effort alongside a commit that has already fully
-- succeeded and is real, permanent history either way; a client that
-- retries this call after a transient failure finds the unique
-- `(model_id, merged_element_id)` index refuses a second row for the same
-- merge, rather than double-recording it.
--
-- Undo needs no new RPC at all: `src/engine/mergeElements.ts`'s
-- `buildUndoMergeElementsDeltas` inverts the original merge commit's own
-- deltas (restore what it retracted, retract what it created) into an
-- ordinary new commit — the same `commitToBranch` path, no special
-- handling. `element_merges` is never updated or deleted to reflect an
-- undo (CLAUDE.md rule 5 names this table explicitly): the row stays a
-- permanent, accurate historical fact ("at this point, X was merged into
-- Y"), exactly as `deltas`/`commits`/`resolved_conflicts` already work —
-- whether that merge is still in effect is answered by whether the merged
-- element is currently live, the same way it's answered for anything else
-- in this schema, not by a second column on this table.

create table element_merges (
  id uuid primary key,
  org_id uuid not null references organisations (id),
  model_id uuid not null references models (id),
  surviving_element_id uuid not null,
  merged_element_id uuid not null check (merged_element_id <> surviving_element_id),
  decided_by uuid not null references auth.users (id),
  rationale text not null,
  evidence_id uuid references evidence (id),
  commit_id uuid not null references commits (id),
  created_at timestamptz not null default now(),
  unique (model_id, merged_element_id)
);

comment on table element_merges is 'ADR-019: a reversible identity merge — X (merged_element_id) was the same real thing as Y (surviving_element_id). Append-only (CLAUDE.md rule 5); the commit named here is the ordinary manual commit that actually retracted X and re-pointed its relationships/children.';

create index element_merges_model_id_idx on element_merges (model_id);
create index element_merges_org_id_idx on element_merges (org_id);

alter table element_merges enable row level security;
alter table element_merges force row level security;

-- Member-scoped select (SPEC §9.5's default template) — no insert/update/
-- delete grant to authenticated at all: the one legitimate writer is
-- atlas.record_element_merge below.
create policy element_merges_select on element_merges
  for select to authenticated
  using (atlas.is_member(org_id));

grant select on element_merges to authenticated;

-- ---------------------------------------------------------------------------
-- atlas.record_element_merge: writes the element_merges row and the
-- merged_id alias together, for a commit that has already been written
-- through the ordinary atlas.commit_deltas path. Re-derives org_id from
-- model_id and decided_by/created_by from auth.uid() itself, never from a
-- client-supplied value (this schema's universal convention) — the real
-- authorization check is that the caller must actually be a member with
-- write access to have gotten a real commit_id to pass in here at all;
-- this function only re-confirms that commit is real, on this model, and
-- not of a kind that would make "this was a merge" a nonsensical claim.
-- ---------------------------------------------------------------------------

create or replace function atlas.record_element_merge(
  p_id uuid,
  p_model_id uuid,
  p_surviving_element_id uuid,
  p_merged_element_id uuid,
  p_merged_element_name text,
  p_rationale text,
  p_commit_id uuid,
  p_alias_id uuid,
  p_name_alias_id uuid,
  p_source_id uuid,
  p_evidence_id uuid default null
)
returns element_merges
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id uuid;
  v_row element_merges;
begin
  select org_id into v_org_id from models where id = p_model_id;
  if v_org_id is null then
    raise exception 'record_element_merge: model % not found', p_model_id using errcode = '22023';
  end if;

  if not exists (select 1 from commits c where c.id = p_commit_id and c.model_id = p_model_id and c.kind = 'manual') then
    raise exception 'record_element_merge: % is not a manual commit on model %', p_commit_id, p_model_id using errcode = '22023';
  end if;

  insert into element_merges (id, org_id, model_id, surviving_element_id, merged_element_id, decided_by, rationale, evidence_id, commit_id)
  values (p_id, v_org_id, p_model_id, p_surviving_element_id, p_merged_element_id, auth.uid(), p_rationale, p_evidence_id, p_commit_id)
  returning * into v_row;

  -- SPEC §3.6: "Rows of alias_type = 'merged_id' have alias_value =
  -- merged_element_id::text and are inserted only by atlas.merge_elements"
  -- — this is that insert. Points at the survivor, so a lookup by the old
  -- (now-retracted) id resolves to the identity that's actually still live.
  insert into aliases (id, org_id, model_id, element_id, alias_value, alias_type, source_id, confidence, created_by)
  values (p_alias_id, v_org_id, p_model_id, p_surviving_element_id, p_merged_element_id::text, 'merged_id', p_source_id, 1, auth.uid());

  -- E7's own golden path — "old name found by search, undo" — needs more
  -- than the merged_id alias above: that one stores the loser's *id*, not
  -- its name (by SPEC §3.6's own explicit design, for resolving a stale
  -- permalink to the survivor), so it can never match a person typing the
  -- loser's old name into search, and `loadSearchPool` deliberately
  -- excludes merged_id aliases from its pool regardless. This ordinary
  -- `name`-type alias is the thing that actually makes the old name
  -- searchable again — no different from any other name alias an element
  -- can carry. A name collision with an existing alias elsewhere in the
  -- model (the same unique (model_id, alias_type, lower(alias_value))
  -- constraint every other name alias is already held to) fails this
  -- insert and rolls back both alias rows and the `element_merges` row
  -- above — the merge commit itself has already succeeded and stays live
  -- either way (this function's own leading comment), the same accepted
  -- rough edge as any other reason this recording step can fail.
  insert into aliases (id, org_id, model_id, element_id, alias_value, alias_type, source_id, confidence, created_by)
  values (p_name_alias_id, v_org_id, p_model_id, p_surviving_element_id, p_merged_element_name, 'name', p_source_id, 1, auth.uid());

  return v_row;
end;
$$;

revoke all on function atlas.record_element_merge(uuid, uuid, uuid, uuid, text, text, uuid, uuid, uuid, uuid, uuid) from public;
grant execute on function atlas.record_element_merge(uuid, uuid, uuid, uuid, text, text, uuid, uuid, uuid, uuid, uuid) to authenticated;
