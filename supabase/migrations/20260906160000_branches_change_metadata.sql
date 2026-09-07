-- Sprint C1 step 2 (schema, part 1 of 2): change-branch metadata columns.
--
-- The "create change" form (name, description, target date, status) needs
-- description/target_date, neither of which existed (SPEC-data-model.md
-- §3.4 had only `title`). split_from is ADR-006's Sprint C1 amendment
-- (docs/ADR-000-foundations.md's "partial delivery is a split branch, not a
-- partial merge commit"): accepting a subset of a branch's changes in the
-- review queue moves that subset into a new branch recording where it came
-- from, so the change page can show an original branch and every branch
-- split from it as one logical change with a delivered/remaining
-- breakdown. See SPEC §1 S-22.

alter table branches
  add column description text,
  add column target_date date,
  add column split_from uuid references branches (id);

comment on column branches.description is 'Change branches: free-text description of the change, set at creation (SPEC §3.4).';
comment on column branches.target_date is 'Change branches: the intended delivery date shown on the change page and roadmap (SPEC §3.4).';
comment on column branches.split_from is 'Set only on a branch created by partial acceptance in the review queue (ADR-006 amendment, SPEC §1 S-22) — the branch it was split out of.';

-- A split is only ever a change branch splitting off another change branch
-- — main and capture_draft branches never go through the review queue's
-- accept/skip flow.
alter table branches add constraint branches_split_from_is_change check (split_from is null or kind = 'change');

create index branches_split_from_idx on branches (split_from) where split_from is not null;

-- Editable at any time by the same roles that can already touch title/
-- shared_for_review (branches_update's existing USING/WITH CHECK, unchanged
-- by this migration) — description/target_date carry no invariant beyond
-- "who may edit this change's own metadata."
grant update (description, target_date) on branches to authenticated;
