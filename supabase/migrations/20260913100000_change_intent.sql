-- Prompt pack F0 ("change intent — the why"): `branches.intent` (record |
-- propose | correct | explore), set at creation, editable only while the
-- branch is still `draft` (S1's "why" convention). This is genuinely new
-- ground for `branches` — every column added so far (title, description,
-- target_date, split_from, cancel_reason/cancelled_at/cancelled_by,
-- dismissed_identity_pairs) has been free-text metadata or a bookkeeping
-- fact set once by a security-definer function; `intent` is the first one
-- that changes what the change *workspace itself* renders and how heavy
-- its review is.
--
-- Never read by src/engine — same stance `status` already takes (see
-- src/db/types.ts's own module comment): this is a workflow/UI enum, not
-- a fact about the model's own elements/relationships.

alter table branches add column intent text;

comment on column branches.intent is 'Prompt pack F0: record | propose | correct | explore, set at creation, editable only while status = ''draft''. Null for main and capture_draft branches — a change branch always has one.';

alter table branches add constraint branches_intent_valid_value
  check (intent is null or intent in ('record', 'propose', 'correct', 'explore'));

-- Backfill: every change branch that already existed before this column
-- did defaults to 'propose' — the most common everyday case, and the same
-- default `directorHome`'s own "Propose a change" entry point uses going
-- forward — since there is no way to recover which of the four this
-- session's own author actually meant after the fact. Printed per row
-- (not silent) so whoever runs this against the live project can review
-- the list, the same transparency `backfillOwnsRole.ts`'s own convention
-- gives a schema-meaning change to existing data. A no-op on a fresh
-- `pnpm db:reset` (nothing exists yet to backfill).
do $$
declare
  r record;
begin
  for r in select id, name, title from branches where kind = 'change' and intent is null loop
    raise notice 'branches.intent backfill: % (%) -> propose', r.id, coalesce(r.title, r.name);
  end loop;
  update branches set intent = 'propose' where kind = 'change' and intent is null;
end $$;

-- A change branch always carries an intent; main/capture_draft never do
-- (neither is "a change" in F0's sense — main has no workspace of its own,
-- and a capture_draft is machine-authored, reviewed through the K1 capture
-- pipeline once it exists, not F0's per-intent workspace).
alter table branches add constraint branches_intent_only_for_change
  check ((kind = 'change') = (intent is not null));

-- ---------------------------------------------------------------------------
-- atlas.guard_branch_intent_update: the same "narrow the update grant,
-- enforce the rest in a trigger" split every other guarded column on this
-- table already uses (branches_update's own comment, 20260906071400_history.sql)
-- — `intent` itself stays freely settable by `branches_insert`'s existing
-- WITH CHECK (unchanged; it never enumerated title/description/target_date
-- either), this only guards *changing* it after creation.
-- ---------------------------------------------------------------------------

create or replace function atlas.guard_branch_intent_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.intent is distinct from old.intent and old.status <> 'draft' then
    raise exception 'guard_branch_intent_update: intent is only editable while the change is a draft' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger branches_guard_intent_update
  before update on branches
  for each row execute function atlas.guard_branch_intent_update();

-- Editable at any time by the same roles that can already touch title/
-- description/target_date (branches_update's existing USING/WITH CHECK,
-- unchanged by this migration) — the guard trigger above is what actually
-- narrows *when*, not this grant.
grant update (intent) on branches to authenticated;

-- atlas.split_branch (20260911020000_split_branch.sql) inserts a new
-- kind='change' branch and would now trip branches_intent_only_for_change
-- (no intent column in its own insert list) on every future call — fixed
-- here, in the same migration that adds the constraint, rather than
-- editing that earlier migration (forward-only). The split inherits the
-- original branch's own intent: a split is, by ADR-006's own framing,
-- exactly a subset of the same already-reviewed change, never a change of
-- purpose — `v_branch` is `select *`, so `v_branch.intent` already reads
-- the new column with zero other changes to this function's body.
create or replace function atlas.split_branch(
  p_new_branch_id uuid,
  p_branch_id uuid,
  p_new_branch_name text,
  p_new_branch_title text,
  p_commit_id uuid,
  p_commit_title text,
  p_deltas jsonb,
  p_merge_request_id uuid,
  p_classification jsonb default '{}'::jsonb
)
returns branches
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_branch branches;
  v_main branches;
  v_new_branch branches;
begin
  select * into v_branch from branches where id = p_branch_id for update;
  if v_branch.id is null then
    raise exception 'split_branch: branch % not found', p_branch_id using errcode = '22023';
  end if;
  if atlas.has_role(v_branch.org_id, 'owner', 'architect') is not true then
    raise exception 'split_branch: only owners and architects may split a branch' using errcode = '42501';
  end if;
  if v_branch.kind <> 'change' then
    raise exception 'split_branch: branch % is not a change branch', p_branch_id using errcode = '42501';
  end if;

  select * into v_main from branches where model_id = v_branch.model_id and kind = 'main';
  if v_main.id is null then
    raise exception 'split_branch: model % has no main branch', v_branch.model_id using errcode = '22023';
  end if;
  -- The same precondition `atlas.approve_merge_request` already requires
  -- of the *original* branch before a reviewer can act on it at all
  -- (ADR-006 §7.1's "mergeBase(B) == main.head") — the closure's own
  -- fresh deltas were computed against main's current head, client-side;
  -- this re-derives that main hasn't moved since, the same way every
  -- other commit-writing RPC re-checks its own staleness precondition
  -- inside the transaction rather than trusting the client's claim.
  if not atlas.branch_reaches_commit(p_branch_id, v_main.head_commit_id) then
    raise exception 'split_branch: REFRESH_REQUIRED — branch has not incorporated main''s current head' using errcode = '55000';
  end if;

  insert into branches (id, org_id, model_id, name, kind, status, base_commit_id, head_commit_id, split_from, target_date, title, created_by, intent)
  values (p_new_branch_id, v_branch.org_id, v_branch.model_id, p_new_branch_name, 'change', 'draft', v_main.head_commit_id, v_main.head_commit_id, p_branch_id, v_branch.target_date, p_new_branch_title, auth.uid(), v_branch.intent)
  returning * into v_new_branch;

  perform atlas.commit_deltas(
    p_commit_id => p_commit_id,
    p_model_id => v_branch.model_id,
    p_branch_id => p_new_branch_id,
    p_base_commit_id => v_main.head_commit_id,
    p_kind => 'manual',
    p_title => p_commit_title,
    p_deltas => p_deltas
  );

  -- Approved directly, never `draft`/`proposed` (ADR-006 amendment rule
  -- 1: created with `status = 'approved'`) — a split is, by construction,
  -- exactly the subset of an already-reviewed branch the reviewer just
  -- chose to accept; there is nothing left for a second review pass to
  -- decide.
  update branches set status = 'approved' where id = p_new_branch_id;

  insert into merge_requests (id, org_id, model_id, branch_id, requested_head_commit_id, main_head_commit_id, status, requested_by, reviewed_by, reviewed_at, classification)
  values (p_merge_request_id, v_branch.org_id, v_branch.model_id, p_new_branch_id, p_commit_id, v_main.head_commit_id, 'approved', auth.uid(), auth.uid(), now(), coalesce(p_classification, '{}'::jsonb));

  select * into v_new_branch from branches where id = p_new_branch_id;
  return v_new_branch;
end;
$$;

revoke all on function atlas.split_branch(uuid, uuid, text, text, uuid, text, jsonb, uuid, jsonb) from public;
grant execute on function atlas.split_branch(uuid, uuid, text, text, uuid, text, jsonb, uuid, jsonb) to authenticated;
