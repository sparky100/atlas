-- SPEC-capture.md §7.6/§10, issue #284: a capture-pipeline audit found that
-- `aliasProposals` (what accepting/merging a candidate would teach the
-- matcher) was threaded through `runCapture.ts`'s own `ResolvedCandidate`
-- (that module's own header comment named this as "not yet persisted onto
-- a capture_candidates row... PR12's own decision") but never actually
-- reached `capture_candidates` or the review queue — §10's `new` row
-- explicitly requires showing it to the reviewer before they decide.
--
-- New column, not a derived read: §7.6's alias proposals are computed once,
-- at extraction/match time, from data (the matched-against `aliasByNormalisedValue`
-- entry, the row's own sourceKey column, the intra-document group) that
-- capture_candidates itself doesn't otherwise retain — recomputing them
-- from `proposal`/`evidence`/`match` at read time would mean re-deriving
-- match-level logic in the UI, the same layering violation CLAUDE.md's
-- code-layout section rules out.

alter table capture_candidates add column alias_proposals jsonb not null default '[]'::jsonb;

comment on column capture_candidates.alias_proposals is 'CaptureAliasProposal[] (SPEC-capture.md §7.6) — what accepting or merging this candidate would write to aliases, shown to the reviewer before they decide (§10).';

-- atlas.write_capture_draft (PR7, 20260920200022) re-created to also insert
-- this column; no signature change (p_candidates already carries the full
-- CaptureCandidateRowShape as jsonb per row).
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

  select head_commit_id into v_main_head_commit_id from branches where model_id = v_job.model_id and kind = 'main';
  select depth into v_parent_depth from commits where id = v_main_head_commit_id;

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
      proposal, evidence, match, confidence, row_key, reimport_status, draft_delta_ids, alias_proposals, decision
    )
    select
      (c ->> 'id')::uuid, v_job.org_id, p_job_id, v_job.model_id, (c ->> 'seq')::int, (c ->> 'kind')::subject_type, c ->> 'class',
      nullif(c ->> 'element_type', '')::element_type, nullif(c ->> 'relationship_type', '')::relationship_type, (c ->> 'draft_subject_id')::uuid,
      c -> 'proposal', c -> 'evidence', c -> 'match', (c ->> 'confidence')::numeric, c ->> 'row_key', nullif(c ->> 'reimport_status', ''),
      coalesce((select array_agg((e)::uuid) from jsonb_array_elements_text(c -> 'draft_delta_ids') as e), '{}'),
      coalesce(c -> 'alias_proposals', '[]'::jsonb),
      -- §4.4's "confirm is the only class pre-staged accepted at write time" (20260920200052's own fix — preserved here).
      case when c ->> 'class' = 'confirm' then 'accepted' else null end
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
