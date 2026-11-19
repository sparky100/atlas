-- Advisor follow-up to 20261119170000_decision_baseline.sql (Simon chose this,
-- 2026-11-19): the baseline foreign key's covering index showed up as a new
-- "unused index" finding, and without the index the key is an "unindexed
-- foreign key" finding. Either way a new finding, which CLAUDE.md rule 9
-- forbids. So the column stays a plain uuid, with no foreign key and no index.
-- The link is still protected: atlas.check_decision_baseline refuses a baseline
-- that is not one of the decision's own linked options, and nothing deletes a
-- branch that a decision links to except atlas.delete_model, which removes the
-- decisions first. The column is only ever read together with the decision's
-- own links, so it needs no index.
alter table decisions drop constraint decisions_baseline_branch_id_fkey;
drop index decisions_baseline_branch_idx;

comment on column decisions.baseline_branch_id is 'Which of this decision''s option branches is the "Stay as we are" baseline. A trigger (atlas.check_decision_baseline) requires it to be linked to the decision as an option; there is deliberately no foreign key or index (advisor findings). Null on decisions made before the baseline existed.';
