-- Sprint C2 (Prompt 7b) step 7, folded in from C1-H: SPEC-data-model.md's
-- own P-18 ("dismissing [an identity warning] persists in `classification`
-- and it is not raised again for the same pair") — until now, "Keep both"
-- (ReviewRequestView.tsx) only ever dismissed a pair for the current
-- browser session (`useReviewRequest.ts`'s own `dismissedIdentityPairs`
-- local state), never written anywhere — a reload, or another reviewer
-- opening the same request, saw the warning again.
--
-- A dedicated column, not folded into `classification` itself:
-- `classification` is wholly recomputed and overwritten on every submit/
-- refresh/resubmit (`atlas.submit_merge_request`/`resubmit_merge_request`),
-- which would silently drop any dismissal recorded there the moment the
-- branch pushes another commit — this needs to survive that recomputation,
-- so it lives in a column those functions never touch.

alter table merge_requests add column dismissed_identity_pairs jsonb not null default '[]'::jsonb;

comment on column merge_requests.dismissed_identity_pairs is 'SPEC §10.2 P-18: identity-warning pairs ("keep both") dismissed for this request, as a jsonb array of the same sorted "<idA> <idB>" pair keys the review UI already derives (useReviewRequest.ts). Survives classification being recomputed on every refresh/resubmit — the review queue filters findings against this list on render, never against a copy baked into classification itself.';

-- ---------------------------------------------------------------------------
-- atlas.dismiss_identity_pair: the one write path for this column, same
-- "narrow the grant, enforce the rest in a function" pattern every other
-- merge_requests mutation already uses (20260906161000_merge_review_queue.sql's
-- own module comment) — a plain grant would let a client dismiss a pair on
-- a request in any org, or overwrite the whole array instead of appending.
-- ---------------------------------------------------------------------------

create or replace function atlas.dismiss_identity_pair(p_merge_request_id uuid, p_pair_key text)
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
    raise exception 'dismiss_identity_pair: merge request % not found', p_merge_request_id using errcode = '22023';
  end if;
  -- Same role floor as submit_merge_request/request_changes (contributor+)
  -- — dismissing an advisory warning is a review action, not an
  -- approve/merge-level one (ADR-006: identity warnings never block
  -- approval, P-18's own wording).
  if atlas.has_role(v_req.org_id, 'owner', 'architect', 'contributor') is not true then
    raise exception 'dismiss_identity_pair: insufficient role in this organisation' using errcode = '42501';
  end if;

  update merge_requests
    set dismissed_identity_pairs = case
      when dismissed_identity_pairs @> to_jsonb(p_pair_key) then dismissed_identity_pairs
      else dismissed_identity_pairs || to_jsonb(p_pair_key)
    end
    where id = p_merge_request_id
    returning * into v_row;

  return v_row;
end;
$$;

revoke all on function atlas.dismiss_identity_pair(uuid, text) from public;
grant execute on function atlas.dismiss_identity_pair(uuid, text) to authenticated;
