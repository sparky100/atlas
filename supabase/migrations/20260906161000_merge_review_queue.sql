-- Sprint C1 step 2 (schema, part 2 of 2): merge requests and the review
-- queue's write paths (ADR-006, SPEC §3.7, §7).
--
-- Every merge_requests mutation goes through one of the five functions
-- below (submit/request_changes/approve/reject/merge_branch), never a raw
-- insert/update — the same "the function is the only writer" discipline
-- atlas.commit_deltas already established for commits. merge_requests
-- therefore needs no insert/update grant to authenticated at all, only
-- select: RLS on the table stays as simple as tags'/commits' own "append-
-- only, no update policy for any application role" (SPEC §9.4), except
-- here even inserts are function-only, because "submit" also has to move
-- branches.status atomically in the same transaction — two RLS-gated
-- writes from the client could partially fail and leave the branch and its
-- request disagreeing about whether it's under review.
--
-- atlas.branch_reaches_commit is the one piece of real DAG logic living in
-- SQL rather than src/engine: it re-derives "mergeBase(B) == main.head"
-- (SPEC §7.1) — expressed equivalently and more cheaply as "is main's
-- current head in B's own ancestry" — as a security check inside
-- approve/merge_branch that a client's own (possibly stale) claim can't be
-- trusted for. It is not a second implementation of src/engine/head.ts's
-- `ancestry`: it answers one membership question, not a full fold, and the
-- actual head content this product ever reasons about is still only ever
-- computed by the engine.

create type merge_request_status as enum ('pending', 'changes_requested', 'approved', 'merged', 'rejected');

create table merge_requests (
  id uuid primary key,
  org_id uuid not null references organisations (id),
  model_id uuid not null references models (id),
  branch_id uuid not null references branches (id),
  requested_head_commit_id uuid not null references commits (id),
  main_head_commit_id uuid not null references commits (id),
  status merge_request_status not null default 'pending',
  requested_by uuid not null,
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_notes text,
  merge_commit_id uuid references commits (id),
  classification jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check ((status = 'merged') = (merge_commit_id is not null))
);

comment on table merge_requests is 'Request to merge a change branch into main (ADR-006, SPEC §3.7). Written only by atlas.submit_merge_request/request_changes/approve_merge_request/reject_merge_request/merge_branch.';

-- One open request per branch (SPEC §3.4/§3.7) — 'merged'/'rejected' are
-- closed and don't count.
create unique index merge_requests_one_open_per_branch_idx on merge_requests (branch_id) where status in ('pending', 'changes_requested', 'approved');
create index merge_requests_model_id_status_idx on merge_requests (model_id, status);
create index merge_requests_org_id_idx on merge_requests (org_id);

alter table merge_requests enable row level security;
alter table merge_requests force row level security;

create policy merge_requests_select on merge_requests
  for select to authenticated
  using (atlas.has_role(org_id, 'owner', 'architect', 'contributor'));

-- No insert/update/delete policy or grant for authenticated at all — see
-- the module comment above. The five functions below are security definer
-- and write this table as their own owner, same as atlas.commit_deltas
-- already does for commits/deltas/branches.
grant select on merge_requests to authenticated;

create table resolved_conflicts (
  id uuid primary key,
  org_id uuid not null references organisations (id),
  model_id uuid not null references models (id),
  winning_delta_id uuid not null references deltas (id),
  discarded_delta_id uuid not null references deltas (id),
  resolution_delta_id uuid references deltas (id),
  resolved_by uuid not null,
  rationale text,
  created_at timestamptz not null default now(),
  check (discarded_delta_id <> winning_delta_id)
);

comment on table resolved_conflicts is 'A human''s choice between two disagreeing facts (ADR-007, SPEC §3.6) — written only by atlas.commit_deltas alongside the resolving merge commit, per SPEC §9''s "insert via procedure only".';

create index resolved_conflicts_model_id_idx on resolved_conflicts (model_id);
create index resolved_conflicts_org_id_idx on resolved_conflicts (org_id);

alter table resolved_conflicts enable row level security;
alter table resolved_conflicts force row level security;

create policy resolved_conflicts_select on resolved_conflicts
  for select to authenticated
  using (atlas.has_role(org_id, 'owner', 'architect', 'contributor'));

grant select on resolved_conflicts to authenticated;

-- ---------------------------------------------------------------------------
-- atlas.branch_reaches_commit: is p_commit_id in ancestry(branch's head)?
-- Mirrors src/engine/head.ts's `ancestry` (parent_commit_id AND
-- merged_branch_head_commit_id), as a membership test rather than a full
-- materialised set, since that's all approve/merge_branch need.
-- ---------------------------------------------------------------------------

create or replace function atlas.branch_reaches_commit(p_branch_id uuid, p_commit_id uuid)
returns boolean
language sql stable
security definer
set search_path = public, pg_temp
as $$
  with recursive edges (from_id, to_id) as (
    -- Scoped to the branch's own model so this doesn't walk every tenant's
    -- commit graph on every call — cheap given commits_model_id_kind_idx.
    select id, parent_commit_id from commits
      where parent_commit_id is not null and model_id = (select model_id from branches where id = p_branch_id)
    union all
    select id, merged_branch_head_commit_id from commits
      where merged_branch_head_commit_id is not null and model_id = (select model_id from branches where id = p_branch_id)
  ),
  anc (id) as (
    select head_commit_id from branches where id = p_branch_id
    union
    select e.to_id from anc a join edges e on e.from_id = a.id
  )
  select exists (select 1 from anc where id = p_commit_id);
$$;

revoke all on function atlas.branch_reaches_commit from public;
grant execute on function atlas.branch_reaches_commit to authenticated;

-- ---------------------------------------------------------------------------
-- atlas.commit_deltas, third generation: `merge` is now allowed on a
-- `change` branch (a refresh, S-11) alongside `manual` — the restriction
-- Sprint H1 item 3 added specifically noted this as the one thing blocking
-- refresh, with no product path yet; Sprint C1's review queue is that path.
-- Also accepts an optional p_resolved_conflicts array, written in the same
-- transaction as the commit that resolves them (SPEC §7.4's field-conflict
-- actions, ADR-007's `resolved_conflicts`).
--
-- Adding `p_resolved_conflicts` as a 13th parameter changes this function's
-- type signature, so `create or replace` below does not replace the second
-- generation's 12-arg function in place — it would silently create a second,
-- coexisting overload instead, which then makes the unqualified
-- revoke/grant below ambiguous (SQLSTATE 42725, "function name ... is not
-- unique"). Drop the old signature explicitly first, and qualify
-- revoke/grant with the full parameter list so a future arity change fails
-- loudly here instead of at "not unique".
-- ---------------------------------------------------------------------------

drop function if exists atlas.commit_deltas(uuid, uuid, uuid, uuid, commit_kind, text, jsonb, uuid, jsonb, jsonb, jsonb, text);

create or replace function atlas.commit_deltas(
  p_commit_id uuid,
  p_model_id uuid,
  p_branch_id uuid,
  p_base_commit_id uuid,
  p_kind commit_kind,
  p_message text,
  p_deltas jsonb,
  p_merged_branch_head_commit_id uuid default null,
  p_elements_head jsonb default null,
  p_relationships_head jsonb default null,
  p_facts jsonb default null,
  p_head_hash text default null,
  p_resolved_conflicts jsonb default null
)
returns commits
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id uuid;
  v_branch_kind branch_kind;
  v_depth int;
  v_commit commits;
begin
  select org_id into v_org_id from models where id = p_model_id;
  if v_org_id is null then
    raise exception 'commit_deltas: model % not found', p_model_id using errcode = '22023';
  end if;

  if atlas.has_role(v_org_id, 'owner', 'architect', 'contributor') is not true then
    raise exception 'commit_deltas: insufficient role in this organisation' using errcode = '42501';
  end if;

  select b.kind, c.depth + 1 into v_branch_kind, v_depth
  from branches b join commits c on c.id = p_base_commit_id
  where b.id = p_branch_id;
  if v_branch_kind is null then
    raise exception 'commit_deltas: base_commit_id % is not a known commit on branch %', p_base_commit_id, p_branch_id using errcode = '22023';
  end if;

  if v_branch_kind = 'main' and atlas.has_role(v_org_id, 'owner', 'architect') is not true then
    raise exception 'commit_deltas: only owners and architects may commit directly to main' using errcode = '42501';
  elsif v_branch_kind = 'change' and not exists (select 1 from branches b where b.id = p_branch_id and b.status = 'draft') then
    raise exception 'commit_deltas: branch % is not a draft change branch', p_branch_id using errcode = '42501';
  elsif v_branch_kind not in ('main', 'change') then
    raise exception 'commit_deltas: cannot commit directly to a % branch', v_branch_kind using errcode = '42501';
  end if;

  -- Sprint H1 item 3, amended Sprint C1: a change branch now also accepts
  -- `merge` (a refresh pulling main into the branch, S-11) alongside
  -- `manual`.
  if v_branch_kind = 'main' and p_kind not in ('manual', 'merge', 'template_seed') then
    raise exception 'commit_deltas: kind % is not allowed on a main commit', p_kind using errcode = '22023';
  elsif v_branch_kind = 'change' and p_kind not in ('manual', 'merge') then
    raise exception 'commit_deltas: kind % is not allowed on a change branch commit', p_kind using errcode = '22023';
  end if;

  insert into commits (id, org_id, model_id, branch_id, parent_commit_id, merged_branch_head_commit_id, kind, message, author_id, depth, head_hash)
  values (
    p_commit_id, v_org_id, p_model_id, p_branch_id, p_base_commit_id, p_merged_branch_head_commit_id, p_kind, p_message, auth.uid(), v_depth,
    case when v_branch_kind = 'main' then decode(p_head_hash, 'hex') else null end
  )
  returning * into v_commit;

  if jsonb_array_length(p_deltas) > 0 then
    insert into deltas (
      id, org_id, model_id, commit_id, seq, kind, subject_id, attribute, element_type, relationship_type, name, parent_id, from_element_id, to_element_id,
      value, previous_delta_id, source_id, source_ref, effective_date, confidence, created_by
    )
    select
      (d ->> 'id')::uuid, v_org_id, p_model_id, p_commit_id, (ord - 1)::int, (d ->> 'kind')::delta_kind, (d ->> 'subject_id')::uuid, d ->> 'attribute',
      nullif(d ->> 'element_type', '')::element_type, nullif(d ->> 'relationship_type', '')::relationship_type, d ->> 'name', (d ->> 'parent_id')::uuid,
      (d ->> 'from_element_id')::uuid, (d ->> 'to_element_id')::uuid, d -> 'value', (d ->> 'previous_delta_id')::uuid, (d ->> 'source_id')::uuid,
      d ->> 'source_ref', nullif(d ->> 'effective_date', '')::date, (d ->> 'confidence')::numeric, auth.uid()
    from jsonb_array_elements(p_deltas) with ordinality as t (d, ord);
  end if;

  if p_resolved_conflicts is not null and jsonb_array_length(p_resolved_conflicts) > 0 then
    insert into resolved_conflicts (id, org_id, model_id, winning_delta_id, discarded_delta_id, resolution_delta_id, resolved_by, rationale)
    select
      coalesce((rc ->> 'id')::uuid, gen_random_uuid()), v_org_id, p_model_id, (rc ->> 'winning_delta_id')::uuid, (rc ->> 'discarded_delta_id')::uuid,
      nullif(rc ->> 'resolution_delta_id', '')::uuid, auth.uid(), rc ->> 'rationale'
    from jsonb_array_elements(p_resolved_conflicts) as rc;
  end if;

  update branches set head_commit_id = p_commit_id where id = p_branch_id;

  if v_branch_kind = 'main' then
    perform atlas.replace_main_head_projection(
      v_org_id, p_model_id, p_base_commit_id, p_commit_id,
      coalesce(p_elements_head, '[]'::jsonb), coalesce(p_relationships_head, '[]'::jsonb), coalesce(p_facts, '[]'::jsonb)
    );
  end if;

  return v_commit;
end;
$$;

revoke all on function atlas.commit_deltas(uuid, uuid, uuid, uuid, commit_kind, text, jsonb, uuid, jsonb, jsonb, jsonb, text, jsonb) from public;
grant execute on function atlas.commit_deltas(uuid, uuid, uuid, uuid, commit_kind, text, jsonb, uuid, jsonb, jsonb, jsonb, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- The review-queue workflow functions. Each is security definer for the
-- same reason atlas.commit_deltas is (ADR-015): they write branches.status
-- and/or merge_requests together with commits, atomically, which the plain
-- RLS on those tables was never written to allow as two separate client
-- writes. Every one re-derives its own authorization from auth.uid() and
-- the row(s) it locks with `for update` — nothing here trusts a
-- client-supplied role or status.
-- ---------------------------------------------------------------------------

-- Submitting a merge request (draft -> proposed, SPEC S-18). p_classification
-- is the engine-computed §7 output (threeWayDiff + classifyMerge), cached
-- here exactly as merge_requests.classification is documented to be
-- ("cached at request and at each refresh", SPEC §7.4) — the engine, not a
-- SQL reimplementation, is still the one place that computation happens.
create or replace function atlas.submit_merge_request(p_id uuid, p_branch_id uuid, p_classification jsonb default '{}'::jsonb)
returns merge_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_branch branches;
  v_main branches;
  v_row merge_requests;
begin
  select * into v_branch from branches where id = p_branch_id for update;
  if v_branch.id is null then
    raise exception 'submit_merge_request: branch % not found', p_branch_id using errcode = '22023';
  end if;

  if atlas.has_role(v_branch.org_id, 'owner', 'architect', 'contributor') is not true then
    raise exception 'submit_merge_request: insufficient role in this organisation' using errcode = '42501';
  end if;
  if v_branch.kind <> 'change' then
    raise exception 'submit_merge_request: branch % is not a change branch', p_branch_id using errcode = '42501';
  end if;
  if v_branch.status <> 'draft' then
    raise exception 'submit_merge_request: branch % is not draft (status %)', p_branch_id, v_branch.status using errcode = '42501';
  end if;

  select * into v_main from branches where model_id = v_branch.model_id and kind = 'main';

  insert into merge_requests (id, org_id, model_id, branch_id, requested_head_commit_id, main_head_commit_id, status, requested_by, classification)
  values (p_id, v_branch.org_id, v_branch.model_id, p_branch_id, v_branch.head_commit_id, v_main.head_commit_id, 'pending', auth.uid(), coalesce(p_classification, '{}'::jsonb))
  returning * into v_row;

  update branches set status = 'proposed' where id = p_branch_id;

  return v_row;
end;
$$;

revoke all on function atlas.submit_merge_request from public;
grant execute on function atlas.submit_merge_request to authenticated;

-- proposed/approved -> draft (SPEC S-18): either a reviewer asking for
-- changes, or the requester themselves reopening a stale request to
-- refresh it (ADR-006's "your branch is behind main, please refresh" —
-- self-service, not reviewer-only, since a branch needing a refresh is not
-- itself a review judgement call).
create or replace function atlas.request_changes(p_merge_request_id uuid, p_review_notes text default null)
returns merge_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_req merge_requests;
  v_row merge_requests;
begin
  select * into v_req from merge_requests where id = p_merge_request_id for update;
  if v_req.id is null then
    raise exception 'request_changes: merge request % not found', p_merge_request_id using errcode = '22023';
  end if;
  if atlas.has_role(v_req.org_id, 'owner', 'architect', 'contributor') is not true then
    raise exception 'request_changes: insufficient role in this organisation' using errcode = '42501';
  end if;
  if v_req.status not in ('pending', 'approved') then
    raise exception 'request_changes: merge request % is % (must be pending or approved)', p_merge_request_id, v_req.status using errcode = '42501';
  end if;

  update merge_requests
    set status = 'changes_requested', reviewed_by = auth.uid(), reviewed_at = now(), review_notes = coalesce(p_review_notes, review_notes)
    where id = p_merge_request_id
    returning * into v_row;

  update branches set status = 'draft' where id = v_req.branch_id;

  return v_row;
end;
$$;

revoke all on function atlas.request_changes from public;
grant execute on function atlas.request_changes to authenticated;

-- pending -> approved (SPEC §7.4's "Approval is enabled only when..."). The
-- UI only offers this button once its own client-side checks pass; this
-- function re-checks the two that are cheap and security-relevant to
-- re-verify server-side (role, and mergeBase(B) == main.head via
-- atlas.branch_reaches_commit) plus the cached classification's blocking
-- flag. Schema validation at the branch head is trusted from the engine
-- exactly as every other commit path already trusts it (see
-- atlas.commit_deltas's own module comment) — re-run in full here would be
-- the second PL/pgSQL implementation this codebase has deliberately never
-- built.
create or replace function atlas.approve_merge_request(p_merge_request_id uuid)
returns merge_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_req merge_requests;
  v_row merge_requests;
  v_main_head uuid;
begin
  select * into v_req from merge_requests where id = p_merge_request_id for update;
  if v_req.id is null then
    raise exception 'approve_merge_request: merge request % not found', p_merge_request_id using errcode = '22023';
  end if;
  if atlas.has_role(v_req.org_id, 'owner', 'architect') is not true then
    raise exception 'approve_merge_request: only owners and architects may approve' using errcode = '42501';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'approve_merge_request: merge request % is not pending (status %)', p_merge_request_id, v_req.status using errcode = '42501';
  end if;

  select head_commit_id into v_main_head from branches where model_id = v_req.model_id and kind = 'main';
  if not atlas.branch_reaches_commit(v_req.branch_id, v_main_head) then
    raise exception 'approve_merge_request: REFRESH_REQUIRED — branch has not incorporated main''s current head' using errcode = '55000';
  end if;
  if coalesce((v_req.classification ->> 'hasBlockingConflict')::boolean, true) then
    raise exception 'approve_merge_request: a blocking conflict remains in the cached classification' using errcode = '55000';
  end if;

  update merge_requests set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), main_head_commit_id = v_main_head
    where id = p_merge_request_id
    returning * into v_row;

  update branches set status = 'approved' where id = v_req.branch_id;

  return v_row;
end;
$$;

revoke all on function atlas.approve_merge_request from public;
grant execute on function atlas.approve_merge_request to authenticated;

-- pending/changes_requested/approved -> rejected. Terminal: SPEC names no
-- transition back out of `rejected` (a rejected change is resubmitted as a
-- new branch/request, same as a merged one is never reopened).
create or replace function atlas.reject_merge_request(p_merge_request_id uuid, p_review_notes text default null)
returns merge_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_req merge_requests;
  v_row merge_requests;
begin
  select * into v_req from merge_requests where id = p_merge_request_id for update;
  if v_req.id is null then
    raise exception 'reject_merge_request: merge request % not found', p_merge_request_id using errcode = '22023';
  end if;
  if atlas.has_role(v_req.org_id, 'owner', 'architect') is not true then
    raise exception 'reject_merge_request: only owners and architects may reject' using errcode = '42501';
  end if;
  if v_req.status not in ('pending', 'changes_requested', 'approved') then
    raise exception 'reject_merge_request: merge request % is already closed (status %)', p_merge_request_id, v_req.status using errcode = '42501';
  end if;

  update merge_requests
    set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), review_notes = coalesce(p_review_notes, review_notes)
    where id = p_merge_request_id
    returning * into v_row;

  update branches set status = 'rejected' where id = v_req.branch_id;

  return v_row;
end;
$$;

revoke all on function atlas.reject_merge_request from public;
grant execute on function atlas.reject_merge_request to authenticated;

-- approved -> merged (SPEC §7.4's final step). Re-checks role and
-- mergeBase(B) == main.head one last time ("they can go stale between the
-- click and the commit") and, if main moved, returns the request to
-- `pending` (its branch to `proposed`) and returns NULL — deliberately not
-- a `raise exception`, which would roll back those same two resets, since
-- a thrown error aborts everything the function did in this transaction,
-- resets included. The caller (src/db, per SPEC's REFRESH_REQUIRED) reads
-- "no commit returned" as the signal, not an error code. The actual commit
-- write on success delegates to atlas.commit_deltas — same function, same
-- validation, same projection write every other commit to main goes
-- through; this is only the bookkeeping merge_branch adds on top (marking
-- the request and the branch merged) in the same transaction.
create or replace function atlas.merge_branch(
  p_merge_request_id uuid,
  p_commit_id uuid,
  p_message text,
  p_elements_head jsonb default '[]'::jsonb,
  p_relationships_head jsonb default '[]'::jsonb,
  p_facts jsonb default '[]'::jsonb,
  p_head_hash text default null
)
returns commits
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_req merge_requests;
  v_branch branches;
  v_main branches;
  v_commit commits;
begin
  select * into v_req from merge_requests where id = p_merge_request_id for update;
  if v_req.id is null then
    raise exception 'merge_branch: merge request % not found', p_merge_request_id using errcode = '22023';
  end if;
  if atlas.has_role(v_req.org_id, 'owner', 'architect') is not true then
    raise exception 'merge_branch: only owners and architects may merge' using errcode = '42501';
  end if;
  if v_req.status <> 'approved' then
    raise exception 'merge_branch: merge request % is not approved (status %)', p_merge_request_id, v_req.status using errcode = '42501';
  end if;

  select * into v_branch from branches where id = v_req.branch_id;
  select * into v_main from branches where model_id = v_req.model_id and kind = 'main';

  if not atlas.branch_reaches_commit(v_req.branch_id, v_main.head_commit_id) then
    update merge_requests set status = 'pending' where id = p_merge_request_id;
    update branches set status = 'proposed' where id = v_req.branch_id;
    return null;
  end if;

  v_commit := atlas.commit_deltas(
    p_commit_id => p_commit_id,
    p_model_id => v_req.model_id,
    p_branch_id => v_main.id,
    p_base_commit_id => v_main.head_commit_id,
    p_kind => 'merge',
    p_message => p_message,
    p_deltas => '[]'::jsonb,
    p_merged_branch_head_commit_id => v_branch.head_commit_id,
    p_elements_head => p_elements_head,
    p_relationships_head => p_relationships_head,
    p_facts => p_facts,
    p_head_hash => p_head_hash
  );

  update merge_requests set status = 'merged', merge_commit_id = v_commit.id, reviewed_by = auth.uid(), reviewed_at = now()
    where id = p_merge_request_id;

  -- ADR-006: the branch becomes merged and read-only, never deleted, so its
  -- own as-is/to-be history stays queryable exactly as it looked when
  -- reviewed.
  update branches set status = 'merged' where id = v_req.branch_id;

  return v_commit;
end;
$$;

revoke all on function atlas.merge_branch from public;
grant execute on function atlas.merge_branch to authenticated;
