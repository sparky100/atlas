-- D1 stage 3: ratings belong to the candidate, not to a delivery branch.
--
-- Stage 1 added `option_id` as a compatibility key but left the primary key
-- on `(decision_id, branch_id, criterion)`. A candidate with no branch cannot
-- be rated under that key. This migration moves the key to the option id and
-- lets `branch_id` be null. Existing ratings keep their branch pointer, so
-- branch-backed and branchless candidates read and write through one shape.
--
-- The option is now the authority for "is this one of this decision's
-- options": a rating must name a `decision_options` row on the same proposed
-- decision. Branch-backed ratings still carry their branch for the older
-- comparison/export reads.

update decision_option_ratings r
set option_id = o.id
from decision_options o
where o.decision_id = r.decision_id
  and o.branch_id = r.branch_id
  and r.option_id is null;

alter table decision_option_ratings alter column branch_id drop not null;
alter table decision_option_ratings alter column option_id set not null;

alter table decision_option_ratings drop constraint decision_option_ratings_pkey;
alter table decision_option_ratings add primary key (decision_id, option_id, criterion);

drop policy decision_option_ratings_insert on decision_option_ratings;
drop policy decision_option_ratings_update on decision_option_ratings;

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
      select 1 from decision_options o
      where o.id = decision_option_ratings.option_id
        and o.decision_id = decision_option_ratings.decision_id
    )
  );

-- `using` keeps an already-stored rating read-only the instant the decision
-- leaves `proposed`; the check repeats the same option/decision ownership.
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
      select 1 from decision_options o
      where o.id = decision_option_ratings.option_id
        and o.decision_id = decision_option_ratings.decision_id
    )
  );

comment on table decision_option_ratings is 'A decision''s own judgement ratings, one row per (decision, option, criterion) - cost/effort/deliveryRisk/timing/vendorFit, defined in src/contracts/decisionCriteria.ts. The option id is the key; branch_id is retained for branch-backed options and is null for a candidate that has not been worked on. Read-only once the decision is no longer proposed (RLS, not a snapshot).';
