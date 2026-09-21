-- F2 (full K1) PR7: SPEC-capture.md §8.1 — atlas.write_capture_draft, the
-- one security-definer transaction that turns a finished capture run into
-- a brand-new, never-merge-eligible `capture_draft` branch; and §3.2's own
-- transition table's `atlas.discard_capture_job`.
--
-- Why write_capture_draft is its own function, not an extension of
-- atlas.commit_deltas — same two reasons seed_from_map.sql already gives
-- for itself:
--   1. Structurally different: it creates a brand-new branch (and advances
--      its head twice — once at creation, once after the commit) in the
--      same call, where commit_deltas assumes an existing branch and a
--      real base commit.
--   2. It writes a table (capture_candidates) commit_deltas never touches,
--      RLS-restricted to system paths for exactly this reason
--      (20260920010000_capture_jobs_and_candidates.sql's own RLS comment:
--      "no insert/update/delete policy or grant for authenticated at
--      all... the worker inserts").
--
-- What it does NOT do: decide what the deltas or candidates are, or
-- validate C1-C21 against them. Same division of labour as commit_deltas
-- (that function's own header comment) and seed_from_map — the caller
-- (the capture-run edge function, PR12) builds the envelope with
-- src/capture/buildCaptureDraftEnvelope.ts and folds it with src/engine
-- (SPEC §8.1 step 3: "the worker has already folded the envelope with
-- src/engine to check [C1-C6]; C9 and C17 are enforced inside apply() on
-- every fold regardless") before ever calling this function. This
-- function's own job is purely to persist that already-checked result
-- atomically, exactly like commit_deltas does for an ordinary commit.
--
-- Runs entirely under the service-role identity — a role commit_deltas's
-- own `only owners and architects may commit directly to main`-style role
-- gate would be meaningless for (SPEC §3.5: capture-run verifies
-- contributor+ membership with the caller's own JWT *before* switching to
-- service role — the real authorization check already happened, one layer
-- up, by the time this function runs). So, unlike commit_deltas/seed_from_map,
-- this is gated purely by its own GRANT — service_role only, no grant to
-- `authenticated` at all, no internal auth.role()/has_role() check (there
-- is no meaningful calling-user identity left to check against: auth.uid()
-- is null under service_role). `created_by`/`author_id` come from the
-- job's own `created_by` column, read inside this function, never from
-- auth.uid() — the same substitution `atlas.replace_main_head_projection`
-- already had to make for `facts.asserted_by` (SPEC §5.1's own "authorId
-- was removed..." note).
create or replace function atlas.write_capture_draft(
  p_job_id uuid,
  p_branch_id uuid,
  p_commit_id uuid,
  p_commit_body text,
  p_deltas jsonb,
  p_candidates jsonb,
  p_stats jsonb
)
returns branches
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job capture_jobs;
  v_main_head_commit_id uuid;
  v_parent_depth int;
  v_branch_title text;
  v_commit_title text;
  v_branch branches;
begin
  select * into v_job from capture_jobs where id = p_job_id for update;
  if v_job.id is null then
    raise exception 'write_capture_draft: capture job % not found', p_job_id using errcode = '22023';
  end if;
  if v_job.status <> 'pending' then
    raise exception 'write_capture_draft: capture job % is % (must be pending)', p_job_id, v_job.status using errcode = '42501';
  end if;

  -- ADR-018: main always has a real head (its own genesis commit, at
  -- minimum), so this is never null — the same guarantee CommitEnvelope's
  -- own `parentCommitId: UUID | null` doc comment already relies on for an
  -- ordinary client-built envelope.
  select head_commit_id into v_main_head_commit_id from branches where model_id = v_job.model_id and kind = 'main';
  select depth into v_parent_depth from commits where id = v_main_head_commit_id;

  -- SPEC §8.1 step 1: name/title are a fixed, deterministic shape, never a
  -- caller-supplied string — computed here, not accepted as a parameter,
  -- so `capture/{job_id}` (and the `unique (model_id, name)` constraint it
  -- leans on to keep one draft branch per job) can never drift by caller.
  v_branch_title := v_job.input_name || ' — ' || coalesce(v_job.document_date::text, current_date::text);
  insert into branches (id, org_id, model_id, name, kind, status, base_commit_id, head_commit_id, title, created_by)
  values (p_branch_id, v_job.org_id, v_job.model_id, 'capture/' || p_job_id, 'capture_draft', 'draft', v_main_head_commit_id, v_main_head_commit_id, v_branch_title, v_job.created_by)
  returning * into v_branch;

  v_commit_title := 'Capture from ' || v_job.input_name;
  insert into commits (id, org_id, model_id, branch_id, parent_commit_id, kind, title, body, author_id, depth)
  values (p_commit_id, v_job.org_id, v_job.model_id, p_branch_id, v_main_head_commit_id, 'capture', v_commit_title, p_commit_body, v_job.created_by, coalesce(v_parent_depth, 0) + 1);

  if jsonb_array_length(p_deltas) > 0 then
    insert into deltas (
      id, org_id, model_id, commit_id, seq, kind, subject_id, attribute, element_type, relationship_type, name, parent_id, from_element_id, to_element_id,
      value, previous_delta_id, source_id, source_ref, effective_date, confidence, created_by
    )
    select
      (d ->> 'id')::uuid, v_job.org_id, v_job.model_id, p_commit_id, (ord - 1)::int, (d ->> 'kind')::delta_kind, (d ->> 'subject_id')::uuid, d ->> 'attribute',
      nullif(d ->> 'element_type', '')::element_type, nullif(d ->> 'relationship_type', '')::relationship_type, d ->> 'name', (d ->> 'parent_id')::uuid,
      (d ->> 'from_element_id')::uuid, (d ->> 'to_element_id')::uuid, nullif(d -> 'value', 'null'::jsonb), (d ->> 'previous_delta_id')::uuid, (d ->> 'source_id')::uuid,
      d ->> 'source_ref', nullif(d ->> 'effective_date', '')::date, (d ->> 'confidence')::numeric, v_job.created_by
    from jsonb_array_elements(p_deltas) with ordinality as t (d, ord);
  end if;

  update branches set head_commit_id = p_commit_id where id = p_branch_id;

  if jsonb_array_length(p_candidates) > 0 then
    insert into capture_candidates (
      id, org_id, job_id, model_id, seq, kind, class, element_type, relationship_type, draft_subject_id,
      proposal, evidence, match, confidence, row_key, reimport_status, draft_delta_ids
    )
    select
      (c ->> 'id')::uuid, v_job.org_id, p_job_id, v_job.model_id, (c ->> 'seq')::int, (c ->> 'kind')::subject_type, c ->> 'class',
      nullif(c ->> 'element_type', '')::element_type, nullif(c ->> 'relationship_type', '')::relationship_type, (c ->> 'draft_subject_id')::uuid,
      c -> 'proposal', c -> 'evidence', c -> 'match', (c ->> 'confidence')::numeric, c ->> 'row_key', nullif(c ->> 'reimport_status', ''),
      coalesce((select array_agg((e)::uuid) from jsonb_array_elements_text(c -> 'draft_delta_ids') as e), '{}')
    from jsonb_array_elements(p_candidates) as c;
  end if;

  update capture_jobs
  set resulting_branch_id = p_branch_id, stats = p_stats, status = 'parsed', finished_at = now(), progress = null
  where id = p_job_id;

  return v_branch;
end;
$$;

revoke all on function atlas.write_capture_draft(uuid, uuid, uuid, text, jsonb, jsonb, jsonb) from public;
grant execute on function atlas.write_capture_draft(uuid, uuid, uuid, text, jsonb, jsonb, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- atlas.discard_capture_job (SPEC-capture.md §3.2's transition table):
-- pending/parsed -> discarded, by the contributor+ who created it or an
-- architect/owner. Mirrors atlas.cancel_change's own shape
-- (20260912111000_cancel_change_function.sql) — row lock, status check,
-- role check, update, return the row — the one function in this migration
-- an ordinary authenticated client actually calls directly.
-- ---------------------------------------------------------------------------
create or replace function atlas.discard_capture_job(p_job_id uuid)
returns capture_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job capture_jobs;
begin
  select * into v_job from capture_jobs where id = p_job_id for update;
  if v_job.id is null then
    raise exception 'discard_capture_job: capture job % not found', p_job_id using errcode = '22023';
  end if;
  if v_job.status not in ('pending', 'parsed') then
    raise exception 'discard_capture_job: capture job % is % (must be pending or parsed)', p_job_id, v_job.status using errcode = '42501';
  end if;
  if not (
    (v_job.created_by = auth.uid() and atlas.has_role(v_job.org_id, 'owner', 'architect', 'contributor') is true)
    or atlas.has_role(v_job.org_id, 'owner', 'architect') is true
  ) then
    raise exception 'discard_capture_job: only the contributor+ who created this job, or an owner/architect, may discard it' using errcode = '42501';
  end if;

  update capture_jobs set status = 'discarded' where id = p_job_id;

  -- A `pending` job (discarded before `write` ever ran) has no resulting
  -- branch yet — nothing to archive.
  if v_job.resulting_branch_id is not null then
    update branches set status = 'archived' where id = v_job.resulting_branch_id;
  end if;

  select * into v_job from capture_jobs where id = p_job_id;
  return v_job;
end;
$$;

revoke all on function atlas.discard_capture_job(uuid) from public;
grant execute on function atlas.discard_capture_job(uuid) to authenticated;
