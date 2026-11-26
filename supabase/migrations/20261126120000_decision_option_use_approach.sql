-- Add "use" to an option's approach: a product that is already in the model
-- (a system or a module of a platform) is used, not bought (Simon, 2026-11-26).
-- The Designer and "Make it an option" suggest it from the model; a person can
-- change it. A plain check-constraint change on the candidate's own column: no
-- function, no grant, no new table, so no advisor finding.

alter table public.decision_options drop constraint decision_options_approach_check;
alter table public.decision_options
  add constraint decision_options_approach_check
  check (approach is null or approach in ('keep', 'use', 'configure', 'buy', 'build', 'no_change'));

comment on column public.decision_options.approach is
  'The option''s approach: keep, use (a product already in the model), configure, buy, build, or no_change for the baseline. Null = not decided yet. Set by the Designer or a person; never inferred after the original backfill.';
