-- SPEC-capture.md §4.4/K-8, issue #285: a capture-pipeline audit found
-- matching never checked the job's own target change branch — only
-- main's head — so a candidate that duplicates something an earlier
-- document in the same session already proposed on that branch (but not
-- yet on main) was silently produced as a second `new` element instead
-- of being flagged as a collision. `duplicate_in_target` is the new
-- class runCapture.ts now assigns for that case: no delta (the draft
-- branch always forks from main, which has no such element to update),
-- shown to the reviewer instead of silently duplicated.

alter table capture_candidates drop constraint capture_candidates_class_check;
alter table capture_candidates add constraint capture_candidates_class_check
  check (class in ('new', 'update', 'confirm', 'conflict', 'ambiguous', 'gone', 'invalid', 'unsourced', 'duplicate_in_target'));

-- The two draft_subject_id checks (auto-named capture_candidates_check2/
-- check3 — declaration order after the two kind/element_type|relationship_type
-- table-level checks, confirmed against this migration's own sibling
-- 20260921040000's identical drop/recreate pattern) widen the same way
-- invalid/unsourced already work: no delta, no draft_subject_id.
alter table capture_candidates drop constraint capture_candidates_check2;
alter table capture_candidates drop constraint capture_candidates_check3;
alter table capture_candidates add constraint capture_candidates_check2
  check ((class in ('invalid', 'unsourced', 'duplicate_in_target')) or draft_subject_id is not null);
alter table capture_candidates add constraint capture_candidates_check3
  check (not (class in ('invalid', 'unsourced', 'duplicate_in_target')) or draft_subject_id is null);
