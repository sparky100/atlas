-- F2 (full K1) PR1: schema foundations for the capture pipeline
-- (docs/SPEC-capture.md §3.2/§3.3/§3.4). `capture_jobs` and
-- `capture_candidates` were named throughout the schema from Sprint F1
-- onward (branch_kind/commit_kind/source_kind already carry
-- 'capture_draft'/'capture'/'capture_job'; sources.capture_job_id already
-- exists as a plain uuid, `20260906071500_sources_and_aliases.sql`'s own
-- comment says "the FK is added by [capture's] own migration") but this is
-- the first migration to actually create either table.

create type capture_status as enum ('pending', 'parsed', 'reviewed', 'discarded');

-- ---------------------------------------------------------------------------
-- capture_jobs (SPEC-data-model.md §3.7, amended by SPEC-capture.md §3.2).
-- `org_id`/`id`/`created_at` follow this schema's own universal convention
-- (every migrated table gets them even when a spec table listing omits
-- them, e.g. merge_requests, 20260906161000_merge_review_queue.sql) rather
-- than the doc's own logical-column list.
-- ---------------------------------------------------------------------------

create table capture_jobs (
  id uuid primary key,
  org_id uuid not null references organisations (id),
  model_id uuid not null references models (id),
  input_kind text not null check (input_kind in ('spreadsheet', 'pdf', 'text')),
  input_name text not null,
  -- The uploaded/pasted object's own storage pointer (§3.4's `capture-inputs`
  -- bucket path) — distinct from any one candidate's own `sourceRef`.
  input_ref text not null,
  input_sha256 bytea not null check (octet_length(input_sha256) = 32),
  document_date date,
  status capture_status not null default 'pending',
  -- Set only by `atlas.write_capture_draft` (PR7) inside the same
  -- transaction that creates the capture_draft branch itself — enforcing
  -- "must be kind = 'capture_draft'" there, not with a table CHECK, matches
  -- this schema's own convention for cross-table invariants (merge_requests'
  -- "branch must be kind = 'change'" is checked in `atlas.submit_for_review`,
  -- not a CHECK constraint either — 20260906161000_merge_review_queue.sql).
  resulting_branch_id uuid references branches (id),
  -- The previous run of the same document (K-7); "same model_id as the
  -- referenced row" is likewise enforced by the RPC that sets this
  -- (PR7/PR9), not a table CHECK.
  reimport_of_job_id uuid references capture_jobs (id),
  -- A convenience default for the review queue's own "promote into…"
  -- picker (UI §5.2 `t`), set by `atlas.apply_capture_decisions` (PR8) —
  -- never a constraint on which branch a candidate can actually promote to.
  target_branch_id uuid references branches (id),
  -- {stage, done, total, startedAt, updatedAt}; stage in ('parse','extract','match','write').
  progress jsonb,
  -- {calls, inputTokens, outputTokens, cacheReadTokens, model, promptVersion}.
  llm_usage jsonb,
  -- Counts by match outcome/class (§8), written once at the end of `write`.
  stats jsonb,
  -- {code, message, detail?} as text (JSON) — SPEC §11's own failure-code
  -- shape, kept as text rather than jsonb so the job list can render it
  -- without a second decode path for a column that's usually null.
  error text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

comment on table capture_jobs is 'One capture-pipeline ingestion run (ADR-004, SPEC-capture.md §3.2).';

create index capture_jobs_model_id_status_idx on capture_jobs (model_id, status);
create index capture_jobs_org_id_idx on capture_jobs (org_id);
create index capture_jobs_reimport_of_job_id_idx on capture_jobs (reimport_of_job_id) where reimport_of_job_id is not null;

-- ---------------------------------------------------------------------------
-- capture_candidates (SPEC-capture.md §3.3, K-2). One row per thing the
-- pipeline proposed, whether or not it became a delta. Mutable workflow
-- state, like merge_requests — the history is the draft commit and the
-- promoting commit, both append-only; this table is not.
-- ---------------------------------------------------------------------------

create table capture_candidates (
  id uuid primary key,
  org_id uuid not null references organisations (id),
  job_id uuid not null references capture_jobs (id) on delete cascade,
  model_id uuid not null references models (id),
  seq int not null,
  kind subject_type not null,
  class text not null check (class in ('new', 'update', 'confirm', 'conflict', 'ambiguous', 'gone', 'invalid', 'unsourced')),
  element_type element_type,
  relationship_type relationship_type,
  check ((kind = 'element') = (element_type is not null)),
  check ((kind = 'relationship') = (relationship_type is not null)),
  -- The element/relationship id used on the draft branch — null for
  -- invalid/unsourced (§4.4: no delta at all for either class).
  draft_subject_id uuid,
  check ((class in ('invalid', 'unsourced')) or draft_subject_id is not null),
  check (not (class in ('invalid', 'unsourced')) or draft_subject_id is null),
  proposal jsonb not null,
  evidence jsonb not null,
  match jsonb not null,
  confidence numeric(3, 2) not null check (confidence between 0 and 1),
  row_key text not null,
  reimport_status text check (reimport_status in ('new', 'changed', 'unchanged', 'gone')),
  draft_delta_ids uuid[] not null default '{}',
  decision text check (decision in ('accepted', 'rejected', 'merged', 'edited', 'split')),
  -- merged: {intoElementId}; edited: {attributes}; split: {acceptedAttributes[]}.
  decision_detail jsonb,
  decided_by uuid,
  decided_at timestamptz,
  promoted_commit_id uuid references commits (id),
  promoted_subject_id uuid,
  created_at timestamptz not null default now(),

  unique (job_id, seq)
);

comment on table capture_candidates is 'Per-candidate proposal/evidence/match/decision, one row per thing a capture run proposed (SPEC-capture.md §3.3, K-2).';

create index capture_candidates_job_id_class_idx on capture_candidates (job_id, class);
create index capture_candidates_job_id_decision_idx on capture_candidates (job_id, decision) where decision is null;
create index capture_candidates_model_id_row_key_idx on capture_candidates (model_id, row_key);
create index capture_candidates_org_id_idx on capture_candidates (org_id);

-- ---------------------------------------------------------------------------
-- sources.capture_job_id: the FK deferred since 20260906071500_sources_and_aliases.sql
-- ("capture_jobs...don't exist yet") now that the target exists.
-- ---------------------------------------------------------------------------

alter table sources add constraint sources_capture_job_id_fkey foreign key (capture_job_id) references capture_jobs (id);

-- ---------------------------------------------------------------------------
-- Storage: capture-inputs (§3.4). Private, path
-- {org_id}/{model_id}/{job_id}/{filename}; insert/select by a contributor+
-- member of the org named in the path's own first segment; no update;
-- delete only by service role (an uploaded document is evidence, kept for
-- as long as the job row exists — application code never deletes it).
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values ('capture-inputs', 'capture-inputs', false, 52428800)
on conflict (id) do nothing;

create policy capture_inputs_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'capture-inputs'
    and atlas.has_role(((storage.foldername(name))[1])::uuid, 'owner', 'architect', 'contributor')
  );

create policy capture_inputs_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'capture-inputs'
    and atlas.has_role(((storage.foldername(name))[1])::uuid, 'owner', 'architect', 'contributor')
  );

-- ---------------------------------------------------------------------------
-- RLS: capture_jobs. A job is visible only to a contributor+ member of its
-- own org — never a viewer (P-K7: a draft is invisible to viewers, ADR-009).
-- Insert is real client-side (§3.2's own transition table: "client insert,
-- RLS: contributor+, created_by = auth.uid()") — everything after that
-- (status, resulting_branch_id, progress, stats, error, finished_at) is
-- written only by the service-role capture-run function or by the
-- security-definer RPCs PR7/PR8 add; no update/delete grant for
-- `authenticated` at all.
-- ---------------------------------------------------------------------------

alter table capture_jobs enable row level security;
alter table capture_jobs force row level security;

create policy capture_jobs_select on capture_jobs
  for select to authenticated
  using (atlas.has_role(org_id, 'owner', 'architect', 'contributor'));

create policy capture_jobs_insert on capture_jobs
  for insert to authenticated
  with check (
    atlas.has_role(org_id, 'owner', 'architect', 'contributor')
    and created_by = auth.uid()
  );

-- ---------------------------------------------------------------------------
-- RLS: capture_candidates. Select only, same contributor+ gate — no
-- insert/update/delete policy or grant for `authenticated` at all (K-2: the
-- worker inserts as service role; `atlas.stage_capture_decisions`/
-- `atlas.apply_capture_decisions`, PR8, update as security-definer RPCs).
-- ---------------------------------------------------------------------------

alter table capture_candidates enable row level security;
alter table capture_candidates force row level security;

create policy capture_candidates_select on capture_candidates
  for select to authenticated
  using (atlas.has_role(org_id, 'owner', 'architect', 'contributor'));
