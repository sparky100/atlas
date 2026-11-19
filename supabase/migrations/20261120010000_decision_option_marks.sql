-- Step 2 of PROPOSAL-designer-to-options-journey (section 5a, the option
-- contract). When the Designer suggests options and a person adds one, the
-- option is a real branch linked to the decision. This table records, per
-- option, that an agent drafted it, what the agent actually said, and who
-- last edited it, so the decision page, the approval pack and the later
-- Challenger and product-evidence steps can show provenance truthfully
-- (Simon, 2026-11-19: AI help must be clearly indicated). It cannot be
-- rebuilt after the fact, which is why it ships with step 2.
--
-- One row per Designer-suggested option. A hand-added option has no row and
-- reads as "added by <name>". This is a record of what the person's client
-- declared, not tamper-proof evidence (same stance as decisions.ai_draft_*).
--
-- * Insert: agent, drafted_at, draft_run_id, suggested_title and
--   suggested_summary, once. They are NOT in the column-level update grant, so
--   a plain client update cannot change them (same shape as
--   decisions.ai_draft_agent).
-- * Update: only edited_by and edited_at, and only to the caller themself.
-- * No delete policy and no delete grant: nothing here is ever deleted.
-- * draft_run_id is reserved for the later run-record table (Challenger step);
--   no foreign key until that table exists.
-- * No foreign keys on branch_id or edited_by, and no org_id column, on
--   purpose: an unindexed foreign key is a Supabase performance advisor
--   finding, and CLAUDE.md rule 9 allows no new finding. Integrity comes from
--   the policies instead: the row must match a real branch-typed option link
--   on a proposed decision, and the organisation is read from the decision.
-- * No functions, triggers or views, so nothing new is callable through the API.

create table decision_option_marks (
  decision_id uuid not null references decisions (id),
  branch_id uuid not null,
  agent text not null check (agent in ('designer')),
  drafted_at timestamptz not null,
  draft_run_id uuid,
  suggested_title text not null check (length(btrim(suggested_title)) between 1 and 200),
  suggested_summary text not null default '' check (length(suggested_summary) <= 2000),
  edited_by uuid,
  edited_at timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  primary key (decision_id, branch_id),
  constraint decision_option_marks_edited_together check ((edited_by is null) = (edited_at is null))
);

comment on table decision_option_marks is 'Per-option provenance for options an agent suggested (only ''designer'' so far): what the agent said, when, and who last edited the option. Insert-only for the agent fields; only edited_by and edited_at change. Never deleted. A hand-added option has no row.';

alter table decision_option_marks enable row level security;
alter table decision_option_marks force row level security;

create policy decision_option_marks_select on decision_option_marks
  for select to authenticated
  using (exists (select 1 from decisions d where d.id = decision_option_marks.decision_id and atlas.is_member(d.org_id)));

create policy decision_option_marks_insert on decision_option_marks
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and edited_by is null
    and edited_at is null
    and exists (
      select 1 from decisions d
      where d.id = decision_option_marks.decision_id
        and d.status = 'proposed'
        and atlas.has_role(d.org_id, 'owner', 'architect', 'contributor')
    )
    and exists (
      select 1 from decision_links dl
      where dl.decision_id = decision_option_marks.decision_id
        and dl.linked_type = 'branch'
        and dl.linked_id = decision_option_marks.branch_id
    )
  );

create policy decision_option_marks_update on decision_option_marks
  for update to authenticated
  using (
    exists (
      select 1 from decisions d
      where d.id = decision_option_marks.decision_id
        and d.status = 'proposed'
        and atlas.has_role(d.org_id, 'owner', 'architect', 'contributor')
    )
  )
  with check (
    edited_by = (select auth.uid())
    and exists (
      select 1 from decisions d
      where d.id = decision_option_marks.decision_id
        and d.status = 'proposed'
        and atlas.has_role(d.org_id, 'owner', 'architect', 'contributor')
    )
  );

revoke all on decision_option_marks from public, anon, authenticated;
grant select, insert on decision_option_marks to authenticated;
grant update (edited_by, edited_at) on decision_option_marks to authenticated;
