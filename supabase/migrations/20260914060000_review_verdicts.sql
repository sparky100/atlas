-- Prompt pack F3a: multiple reviewers.
--
-- Adds the review-verdict model (a `review_verdicts` table, one row per
-- assigned reviewer per merge request), the two new `organisations` columns
-- the F3a sign-up/review policy needs (`is_personal`, the "just me" flag;
-- `review_min_required_architects`, the org setting for the minimum
-- required reviewer set), and a `merge_request_id` column on `notifications`
-- so a review-assignment notification can deep-link to its request.
--
-- The `notification_kind` enum value this feature also needs
-- (`'review_assigned'`) lives in its own migration
-- (20260914070000_notification_kind_review_assigned.sql) — Postgres refuses
-- to reference a newly-added enum label by name in the same transaction that
-- adds it, the same split `20260906340000` already established for `'reply'`.
-- The RPCs that write verdicts and the assignment notifications follow in
-- 20260914080000_review_verdict_rpcs.sql, after that enum value exists.

create type review_verdict as enum ('approve', 'request_changes', 'abstain', 'pending');

create table review_verdicts (
  id uuid primary key,
  org_id uuid not null references organisations (id),
  model_id uuid not null references models (id),
  merge_request_id uuid not null references merge_requests (id),
  user_id uuid not null references auth.users (id),
  -- Whether this reviewer's approval is required for the merge gate
  -- ("every required reviewer approved"). The derived set (owners + one
  -- architect) is required by default; a reviewer the proposer adds is
  -- optional by default; the proposer may promote/demote.
  required boolean not null default false,
  verdict review_verdict not null default 'pending',
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table review_verdicts is 'F3a: one row per assigned reviewer per merge request. Written only by atlas.submit_merge_request (the initial pending set), atlas.set_reviewers (proposer add/remove), and atlas.set_review_verdict (a reviewer''s own verdict) — never a raw client insert/update.';

create unique index review_verdicts_request_user_idx on review_verdicts (merge_request_id, user_id);
create index review_verdicts_model_status_idx on review_verdicts (model_id);
create index review_verdicts_org_idx on review_verdicts (org_id);

alter table review_verdicts enable row level security;
alter table review_verdicts force row level security;

create policy review_verdicts_select on review_verdicts
  for select to authenticated
  using (atlas.is_member(org_id));

grant select on review_verdicts to authenticated;

-- No insert/update/delete policy or grant for authenticated — see the table
-- comment above. The three atlas.* functions are security definer and write
-- this table as their own owner, the same shape merge_requests itself uses.

-- ---------------------------------------------------------------------------
-- organisations: the "just me" flag and the review-policy setting.
-- ---------------------------------------------------------------------------

alter table organisations add column is_personal boolean not null default false;

comment on column organisations.is_personal is 'F3a: a personal ("just me") organisation — reads as such in settings, and skips the invite step. Set at creation only; a normal organisation keeps the default false.';

alter table organisations add column review_min_required_architects int not null default 1 check (review_min_required_architects >= 0);

comment on column organisations.review_min_required_architects is 'F3a: the minimum number of architect members the required reviewer set must include (the org''s review policy). Default 1 — at least one architect approval is always required for a propose/explore change.';

-- Owner-only (organisations_update''s existing RLS), and only this one
-- column is newly grantable — name/slug stay as 20260911050000 left them.
grant update (review_min_required_architects) on organisations to authenticated;

-- ---------------------------------------------------------------------------
-- notifications: a review notification names a merge request, not a comment.
-- ---------------------------------------------------------------------------

alter table notifications add column merge_request_id uuid references merge_requests (id);

comment on column notifications.merge_request_id is 'F3a: set only for review notifications (kind ''review_assigned''), null for comment mention/reply notifications. A merge request is never hard-deleted, so no on delete cascade — the same append-only reasoning merge_requests''s own history follows.';
