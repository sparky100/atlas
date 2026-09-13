-- S1 item 16 (docs/prompts/atlas-prompt-pack.md:110, "BranchRebasePanel uses
-- the persisted identity-dismiss RPC"): `20260911030000_persist_identity_dismissals.sql`
-- fixed this for a merge request's own review page (`useReviewRequest.ts`),
-- but `BranchRebasePanel.tsx` (a draft change's own "rebase on main",
-- shown only while no merge request exists yet — see `ChangeView.tsx`'s
-- own call site: `branch.status === 'draft' && openRequest === null`) had
-- nothing to persist against: `atlas.dismiss_identity_pair` is keyed on
-- `merge_requests.id`, and there is no merge request row at that point in
-- the flow. Same gap, same fix, one level earlier — a branch-scoped column
-- and RPC mirroring that migration's own shape exactly, so a dismissal
-- made before ever submitting for review still survives a reload (or a
-- second contributor opening the same draft), instead of resetting the
-- moment `useReviewRequest.ts` takes over post-submission.
--
-- Not merged into `merge_requests.dismissed_identity_pairs` itself — that
-- column doesn't exist until a request does. Not reused by copying it
-- across at submit time either: `atlas.submit_merge_request` already computes
-- `classification` fresh from the branch's own commits at submission, and a
-- rebase-time dismissal is exactly the kind of thing that classification
-- pass should already reflect once real; this column exists purely for the
-- pre-submission window, and a submitted request's own review page manages
-- its own copy going forward via the existing merge-request RPC.

alter table branches add column dismissed_identity_pairs jsonb not null default '[]'::jsonb;

comment on column branches.dismissed_identity_pairs is 'SPEC §10.2 P-18, pre-submission half: identity-warning pairs ("keep both") dismissed on this draft change''s own rebase panel (BranchRebasePanel.tsx), before any merge request exists to hold merge_requests.dismissed_identity_pairs instead. Same sorted "<idA> <idB>" pair-key shape, same idempotent-append RPC pattern as that column.';

-- ---------------------------------------------------------------------------
-- atlas.dismiss_identity_pair_on_branch: the one write path for this column
-- — same "narrow the grant, enforce the rest in a function" pattern
-- atlas.dismiss_identity_pair itself uses, and the same contributor+ role
-- floor (dismissing an advisory warning is a review action, not an
-- approve/merge-level one; ADR-006, P-18's own wording).
-- ---------------------------------------------------------------------------

create or replace function atlas.dismiss_identity_pair_on_branch(p_branch_id uuid, p_pair_key text)
returns branches
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_branch branches;
  v_row branches;
begin
  select * into v_branch from branches where id = p_branch_id for update;
  if v_branch.id is null then
    raise exception 'dismiss_identity_pair_on_branch: branch % not found', p_branch_id using errcode = '22023';
  end if;
  if atlas.has_role(v_branch.org_id, 'owner', 'architect', 'contributor') is not true then
    raise exception 'dismiss_identity_pair_on_branch: insufficient role in this organisation' using errcode = '42501';
  end if;

  update branches
    set dismissed_identity_pairs = case
      when dismissed_identity_pairs @> to_jsonb(p_pair_key) then dismissed_identity_pairs
      else dismissed_identity_pairs || to_jsonb(p_pair_key)
    end
    where id = p_branch_id
    returning * into v_row;

  return v_row;
end;
$$;

revoke all on function atlas.dismiss_identity_pair_on_branch(uuid, text) from public;
grant execute on function atlas.dismiss_identity_pair_on_branch(uuid, text) to authenticated;
