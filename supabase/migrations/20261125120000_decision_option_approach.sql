-- Store each option's approach: Keep, Configure, Buy, Build, or No change
-- (the baseline). Walkthrough finding 2 (Simon, 2026-11-20): a person could not
-- tell a custom-build option from a product option, and the page guessed the
-- approach from the first word of the title, so renaming an option silently
-- lost its starter actions, catalogue products and research suggestion.
--
-- The approach belongs to the candidate, not to the live model, so it is a
-- plain column with the option's own audit and RLS, never a delta. Null means
-- "not decided yet": a person can add an option without choosing one.
--
-- Backfill uses the same title rule the page used until now (Keep, Configure,
-- Replace -> buy, Build) and marks each decision's baseline as no_change.
-- Anything else stays null; nothing is guessed beyond that rule.
--
-- No function is added, so this migration adds no advisor finding.

alter table public.decision_options
  add column approach text
  check (approach is null or approach in ('keep', 'configure', 'buy', 'build', 'no_change'));

comment on column public.decision_options.approach is
  'The option''s approach: keep, configure, buy, build, or no_change for the baseline. Null = not decided yet. Set by the Designer or a person; never inferred after this backfill.';

update public.decision_options o
set approach = case
  when lower(btrim(o.title)) ~ '^keep\M' then 'keep'
  when lower(btrim(o.title)) ~ '^configure\M' then 'configure'
  when lower(btrim(o.title)) ~ '^(replace|buy)\M' then 'buy'
  when lower(btrim(o.title)) ~ '^build\M' then 'build'
end
where o.approach is null;

update public.decision_options o
set approach = 'no_change'
from public.decisions d
where (d.baseline_option_id = o.id
    or (d.baseline_option_id is null and d.baseline_branch_id is not null and d.baseline_branch_id = o.branch_id))
  and d.id = o.decision_id;
