-- F4 (docs/prompts/atlas-prompt-pack.md, "duplicates report (Q1)"): schema
-- foundations for the standing duplicates report ADR-019 names and defers
-- (docs/ADR-000-foundations.md, "Amended (F4, ...)" — read that paragraph
-- first; this migration is exactly what it describes).
--
-- Three new tables, none of them rule-5-protected model data (they're
-- operational tooling recording *that a check ran* and *what a human
-- decided about a pair*, the same status `capture_jobs` already has) —
-- `duplicate_check_runs` (one row per detection run, manual or scheduled),
-- `duplicate_candidates` (the current, re-computed-each-run set of
-- plausible duplicate pairs for a model), `duplicate_dismissals` (a
-- human's permanent "not a duplicate" for one pair, never automatically
-- cleared). Detection itself (`atlas.run_duplicate_check`) and the dismiss
-- RPC (`atlas.dismiss_duplicate_pair`) are their own migration (Step 3) —
-- this one is schema + RLS + the per-model toggle only.

create type duplicate_check_status as enum ('running', 'succeeded', 'failed');

-- ---------------------------------------------------------------------------
-- duplicate_check_runs — one row per detection run against one model,
-- manual (triggered_by a real user) or scheduled (triggered_by null, the
-- pg_cron sweep Step 6 may add later). The report's own "last checked"
-- surface reads the newest row per model; a run stuck in 'running' past a
-- short window is what `atlas.run_duplicate_check`'s own overlap guard
-- (Step 3) checks against to refuse a second concurrent run on the same
-- model.
-- ---------------------------------------------------------------------------

create table duplicate_check_runs (
  id uuid primary key,
  org_id uuid not null references organisations (id),
  model_id uuid not null references models (id),
  triggered_by uuid references auth.users (id),
  status duplicate_check_status not null default 'running',
  candidate_count int,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

comment on table duplicate_check_runs is 'F4/ADR-019: one duplicate-detection run against one model. triggered_by null means a scheduled (pg_cron) run, not a real user. Never updated/deleted by application code except by atlas.run_duplicate_check itself moving a row from running to succeeded/failed.';

create index duplicate_check_runs_model_id_created_at_idx on duplicate_check_runs (model_id, created_at desc);

alter table duplicate_check_runs enable row level security;
alter table duplicate_check_runs force row level security;

-- Same role floor as capture_jobs (contributor+, not every member) — this
-- is curation/maintenance tooling, not a first-class model view. No
-- insert/update/delete grant to authenticated at all: every write goes
-- through atlas.run_duplicate_check (security definer, Step 3).
create policy duplicate_check_runs_select on duplicate_check_runs
  for select to authenticated
  using (atlas.has_role(org_id, 'owner', 'architect', 'contributor'));

grant select on duplicate_check_runs to authenticated;

-- ---------------------------------------------------------------------------
-- duplicate_candidates — the current set of plausible duplicate pairs for a
-- model, re-computed by every atlas.run_duplicate_check call: a pair that
-- no longer meets the threshold is deleted, not merely left stale. Rows
-- here are never the source of truth for "does this pair still make
-- sense" on their own — the report's own read query (Step 5) joins both
-- sides to elements_head at main's current head, so a merged-away or
-- retracted element silently drops the pair with no cleanup RPC needed.
-- ---------------------------------------------------------------------------

create table duplicate_candidates (
  id uuid primary key,
  org_id uuid not null references organisations (id),
  model_id uuid not null references models (id),
  element_a_id uuid not null,
  element_b_id uuid not null,
  -- v1 scope: system/container only (ADR-000's "Amended (F4, ...)" item 2)
  -- — capability/actor duplication is a different, lower-value
  -- conversation this build doesn't take on. Both sides of a pair always
  -- share this type by construction (the detection query only ever
  -- compares same-type elements).
  element_type element_type not null check (element_type in ('system', 'container')),
  score numeric(4, 3) not null check (score >= 0 and score <= 1),
  name_similarity real not null check (name_similarity >= 0 and name_similarity <= 1),
  -- {sharedOwner, sharedVendor, sharedParent, sharedDescription,
  -- neighbourOverlapCount, matchedVia} — the exact inputs the score above
  -- was computed from, so the report can show real signal badges rather
  -- than a second, hand-computed approximation of what fired.
  signals jsonb not null default '{}'::jsonb,
  last_seen_check_run_id uuid not null references duplicate_check_runs (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (element_a_id < element_b_id),
  unique (model_id, element_a_id, element_b_id)
);

comment on table duplicate_candidates is 'F4/ADR-019: a plausible duplicate pair for one model, re-computed on every atlas.run_duplicate_check call — refreshed if it still qualifies, deleted if it no longer does. element_a_id < element_b_id (a single canonical ordering per unordered pair, never two rows for the same pair).';

create index duplicate_candidates_model_id_score_idx on duplicate_candidates (model_id, score desc);
create index duplicate_candidates_last_seen_check_run_id_idx on duplicate_candidates (last_seen_check_run_id);

alter table duplicate_candidates enable row level security;
alter table duplicate_candidates force row level security;

create policy duplicate_candidates_select on duplicate_candidates
  for select to authenticated
  using (atlas.has_role(org_id, 'owner', 'architect', 'contributor'));

grant select on duplicate_candidates to authenticated;

-- ---------------------------------------------------------------------------
-- duplicate_dismissals — a human's "not a duplicate" for one pair,
-- permanent until an explicit un-dismiss (not offered in v1 — no
-- precedent for one, and since this table isn't rule-5-protected, adding
-- an owner-only undo RPC later is an ordinary feature addition, not a
-- design change now). atlas.dismiss_duplicate_pair (Step 3) inserts here
-- and deletes the matching duplicate_candidates row in the same call, so
-- the report reflects a dismissal immediately rather than waiting for the
-- next run to prune it.
-- ---------------------------------------------------------------------------

create table duplicate_dismissals (
  id uuid primary key,
  org_id uuid not null references organisations (id),
  model_id uuid not null references models (id),
  element_a_id uuid not null,
  element_b_id uuid not null,
  dismissed_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  check (element_a_id < element_b_id),
  unique (model_id, element_a_id, element_b_id)
);

comment on table duplicate_dismissals is 'F4/ADR-019: a human decided element_a_id/element_b_id are not the same real thing. Consulted by atlas.run_duplicate_check so a dismissed pair is never re-proposed. Append-only in v1 (no un-dismiss action exists yet).';

create index duplicate_dismissals_model_id_idx on duplicate_dismissals (model_id);

alter table duplicate_dismissals enable row level security;
alter table duplicate_dismissals force row level security;

create policy duplicate_dismissals_select on duplicate_dismissals
  for select to authenticated
  using (atlas.has_role(org_id, 'owner', 'architect', 'contributor'));

grant select on duplicate_dismissals to authenticated;

-- ---------------------------------------------------------------------------
-- models.duplicates_check_enabled — the per-model on/off toggle for the
-- nightly sweep (Step 6), default off (this is new background compute
-- against every existing model; nothing scans until an architect opts in
-- — the manual "Check now" button works regardless of this flag). A plain
-- column grant, not a new RPC: unlike archived_at
-- (20260911040000_model_archive.sql, deliberately withheld from the
-- blanket grant because a raw update would let an architect bypass
-- restore_model's own stricter, owner-only rule), no such asymmetry exists
-- for this toggle — models_update's existing RLS (owner/architect,
-- 20260906071300_models.sql) already gates it correctly on its own.
-- ---------------------------------------------------------------------------

alter table models add column duplicates_check_enabled boolean not null default false;

comment on column models.duplicates_check_enabled is 'F4/ADR-019: per-model opt-in for the nightly duplicate-check sweep (pg_cron, Step 6). Default false. Toggled directly by owner/architect via models_update''s own RLS — no dedicated RPC.';

grant update (duplicates_check_enabled) on models to authenticated;
