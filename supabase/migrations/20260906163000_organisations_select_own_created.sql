-- Sprint C1-H item 1: the real root cause behind "database"/"e2e" never
-- going green, once the atlas.commit_deltas overload bug (previous
-- migration's fix) stopped masking it.
--
-- createOrganisation (src/db/organisations.ts) does
-- `.insert(row).select('*').single()` — a single INSERT ... RETURNING *
-- request. Postgres requires a row returned by RETURNING to also satisfy
-- the table's SELECT policy (organisations_select: `atlas.is_member(id)`),
-- and raises the *same* "new row violates row-level security policy"
-- error as a failed WITH CHECK when it doesn't — not a silent omission.
-- atlas.on_organisation_created (the AFTER INSERT trigger that makes the
-- creator a member) fires only once the INSERT's own row processing —
-- including the RETURNING projection's policy check — has already run, so
-- alice is not yet a member of the org she is creating at the exact moment
-- that check happens. organisations_insert's own WITH CHECK
-- (`created_by = auth.uid()`) was never the problem; confirmed via a
-- temporary debug_whoami()/debug_try_insert_org() RPC pair in this
-- session (removed once this was root-caused) that auth.uid() and the
-- row's created_by were identical at insert time, and that the identical
-- failure reproduces even inserting directly in a plpgsql function —
-- exactly what this RETURNING-vs-SELECT-policy interaction predicts.
--
-- Fix: a creator can always see the organisation they just created — true
-- by construction, since atlas.on_organisation_created makes them its
-- owner in the same transaction — so extending the SELECT policy's USING
-- clause to include `created_by = auth.uid()` grants no capability beyond
-- what the trigger already guarantees; it just removes the RETURNING-time
-- race. No other table has this shape (every other membership-gated table
-- depends on *organisation* membership created earlier by this same
-- trigger, not on a trigger the table's own insert triggers itself).

drop policy organisations_select on organisations;

create policy organisations_select on organisations
  for select to authenticated
  using (atlas.is_member(id) or created_by = auth.uid());
