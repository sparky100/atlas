-- Decision criteria ratings: "add fixed decision criteria ratings so an
-- architect can compare options on judgement, not just structure." The
-- five criteria and their three level labels are code
-- (`src/contracts/decisionCriteria.ts`), not a table — same "the taxonomy
-- is fully known, no admin surface" reasoning `relationship_type_rules`
-- (SPEC-data-model.md §3.3) already gives for staying a constant. This
-- migration ships only the *ratings themselves* — one row per
-- (decision, option, criterion), same tier as `decision_arguments`/
-- `decision_links` (20260913110000_decisions.sql): a plain RLS-guarded
-- table, never part of the delta/commit/head model — "changes stay pure
-- and know nothing about ratings."
--
-- Read-only once chosen, with no extra snapshot step and no RPC change:
-- both `decision_option_ratings_insert`/`_update` below require
-- `decisions.status = 'proposed'` in their own `with check`/`using`
-- clauses — the moment `atlas.choose_decision_option`
-- (20260913120000_choose_decision_option.sql) flips a decision to
-- `accepted`, every further write here is refused by RLS itself. "The
-- ratings that were in place at the time of choosing" is simply "whatever
-- is stored right now" — nothing here mutates them.
--
-- Permission tier: owner/architect/contributor, mirroring
-- `decision_links_insert` (adding an option is the closest existing
-- precedent — "contributing content to an open decision" — not the
-- narrower `decisions_update` tier, which is for the decision's own core
-- fields and limited to its creator or owner/architect).

create table decision_option_ratings (
  decision_id uuid not null references decisions (id),
  branch_id uuid not null references branches (id),
  -- Verbatim `DecisionCriterionKey` values (`src/contracts/decisionCriteria.ts`)
  -- — no camelCase/snake_case translation layer between the contract and
  -- this column.
  criterion text not null check (criterion in ('cost', 'effort', 'deliveryRisk', 'timing', 'vendorFit')),
  -- Verbatim `DecisionRatingLevel` values — neutral, never a per-criterion
  -- enum; each criterion's own display label lives in code, not here.
  level text not null check (level in ('favourable', 'acceptable', 'unfavourable')),
  -- "One-line notes are not a documents feature" — capped to match
  -- `DECISION_RATING_NOTE_MAX_LENGTH`. `btrim` mirrors `decisions.title`'s
  -- own convention for a short free-text field's length check.
  note text check (note is null or length(btrim(note)) <= 200),
  rated_by uuid not null references auth.users (id),
  rated_at timestamptz not null default now(),
  -- One rating per (decision, option, criterion) — rating the same cell
  -- again is an update, not a second row; this is also the upsert's own
  -- `on conflict` target.
  primary key (decision_id, branch_id, criterion)
);

comment on table decision_option_ratings is 'A decision''s own judgement ratings, one row per (decision, option, criterion) — cost/effort/deliveryRisk/timing/vendorFit, defined in src/contracts/decisionCriteria.ts. Read-only once the decision is no longer proposed (RLS, not a snapshot).';

create index decision_option_ratings_decision_id_idx on decision_option_ratings (decision_id);

alter table decision_option_ratings enable row level security;
alter table decision_option_ratings force row level security;

create policy decision_option_ratings_select on decision_option_ratings
  for select to authenticated
  using (exists (select 1 from decisions d where d.id = decision_option_ratings.decision_id and atlas.is_member(d.org_id)));

-- Same predicate on insert and update: the decision must still be
-- `proposed`, the rater must hold at least contributor on the decision's
-- own org (`decision_links_insert`'s tier), and `branch_id` must actually
-- be a linked `branch`-typed option on this decision — the same "is this
-- really one of the decision's own options" guard `atlas.
-- choose_decision_option` applies before it will act on a branch id.
create policy decision_option_ratings_insert on decision_option_ratings
  for insert to authenticated
  with check (
    rated_by = auth.uid()
    and exists (
      select 1 from decisions d
      where d.id = decision_option_ratings.decision_id
        and d.status = 'proposed'
        and atlas.has_role(d.org_id, 'owner', 'architect', 'contributor')
    )
    and exists (
      select 1 from decision_links dl
      where dl.decision_id = decision_option_ratings.decision_id
        and dl.linked_type = 'branch'
        and dl.linked_id = decision_option_ratings.branch_id
    )
  );

-- `using` (not just `with check`) is what actually makes an already-stored
-- rating read-only the instant its decision is no longer `proposed` — a
-- plain client update on a row whose *current* decision status fails this
-- is refused before the new values are even considered.
create policy decision_option_ratings_update on decision_option_ratings
  for update to authenticated
  using (
    exists (
      select 1 from decisions d
      where d.id = decision_option_ratings.decision_id
        and d.status = 'proposed'
        and atlas.has_role(d.org_id, 'owner', 'architect', 'contributor')
    )
  )
  with check (
    rated_by = auth.uid()
    and exists (
      select 1 from decisions d
      where d.id = decision_option_ratings.decision_id
        and d.status = 'proposed'
        and atlas.has_role(d.org_id, 'owner', 'architect', 'contributor')
    )
    and exists (
      select 1 from decision_links dl
      where dl.decision_id = decision_option_ratings.decision_id
        and dl.linked_type = 'branch'
        and dl.linked_id = decision_option_ratings.branch_id
    )
  );

grant select, insert, update on decision_option_ratings to authenticated;
-- No delete policy: this sprint's own UI only ever sets or changes a
-- rating (the brief's own words), never clears one back to "not rated" —
-- the same "no editing UI, no grant" posture `decision_links` itself
-- already takes for its own not-yet-built update/delete affordances.
