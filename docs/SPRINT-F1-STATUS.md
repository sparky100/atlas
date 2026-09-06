# Sprint F1 — foundations, no UI: status against CLAUDE.md's Definition of Done

Sprint F1 built the data model, the delta/head/branch/merge engine, and the
repository layer — steps 1 through 6 of the brief, each committed and
summarised separately. This document is step 7: an honest pass over
CLAUDE.md's Definition of Done, bullet by bullet, against everything built
in steps 1–6. CLAUDE.md is explicit that a sprint is not done until *all*
of its bullets are true, "not merely attempted," and that a false one
should be said plainly rather than reported as complete. That is the spirit
of this document — one bullet below is not true, and is flagged as such
rather than resolved unilaterally.

## Tests green

`pnpm typecheck`, `pnpm lint`, and `pnpm test` were re-run fresh (not just
recalled from earlier steps) as part of this review:

- `pnpm typecheck` — clean, no errors.
- `pnpm lint` — clean, no errors or warnings.
- `pnpm test` (unit + property, excluding `*.integration.test.ts`) — **94
  passed, 0 failed**, across 8 test files (contracts round-trip and
  property tests, engine deltas/head/branch/merge, db env and commit
  shape-checks).

`src/db/repository.integration.test.ts` (the real-Supabase auth/RLS/
concurrency test written in step 6) was **not executed** in this sandbox —
its own module comment says why: this sandbox's network policy blocks the
Docker Hub pulls `supabase start` needs, so there is no running GoTrue/
PostgREST here to hit. It typechecks and lints cleanly, and the SQL
mechanics it exercises (RLS tenant isolation, the branch-head compare-
and-swap, `atlas.guard_branch_head_advance`) were separately rehearsed by
hand — see "Migration applied to a fresh project from zero" below for what
that rehearsal covered this time. CI's `database` job, wired since step 1
with real Docker access, is what actually runs this file; it has not yet
had a chance to on this branch.

## Migration applied to a fresh project from zero

Rehearsed by hand against a brand-new local Postgres 16 instance (the
sandbox's established substitute for `supabase start`, run as the
`postgres` system user with a minimal `auth` schema shim), freshly for
this review:

- All 8 migration files applied cleanly, in order, to a completely empty
  database via `supabase db push`.
- A second, identical `db push` against the now-migrated database reported
  `upToDate: true` — confirmed idempotent.
- A full end-to-end SQL smoke scenario was then run through the resulting
  schema, as `authenticated`/`service_role`, exercising every table
  together: an organisation created (with `atlas.on_organisation_created`
  correctly making its creator `owner`), a model created (with
  `atlas.on_model_created` correctly auto-creating its `main` branch), a
  genesis commit bootstrapped as `service_role` (the documented gap: there
  is no `atlas.seed_from_map` yet, so nothing lets a plain `authenticated`
  user insert a commit with a null parent), a `source`, a `change` branch
  forked from that genesis commit, a real commit with a delta on that
  branch, the branch head advanced by compare-and-swap, an alias, and a
  tag on the main-branch commit.
- Three negative paths were exercised directly, not just asserted: (a) a
  second commit competing for the same parent on the same branch was
  rejected by the `unique (branch_id, parent_commit_id)` index before ever
  reaching the head-advance trigger — the first line of defence against a
  lost race, exactly as `src/db/commits.ts`'s module comment describes;
  (b) `atlas.guard_branch_head_advance` rejected a head advance attempted
  while the branch's status was not `draft` (S-18), with the exact
  documented error; (c) the `commits` RLS insert policy independently
  rejected inserting a new commit onto that same non-draft branch — two
  layers protecting the same invariant, not one.
- Tenant isolation was checked across every table at once: a second user
  with no membership in the test organisation saw zero rows in
  `organisations`, `models`, `branches`, `commits`, `deltas`, `tags`,
  `aliases`, and `sources`.
- The rehearsal instance was torn down after this review (data directory
  removed, process stopped).

This is the same rehearsal technique used at every prior migration-writing
step this sprint, for the same reason: this sandbox cannot run
`supabase start` at all (Docker Hub is unreachable here). It has not
changed since step 1, and CI's `database` job — which has real Docker
access — is what proves this against the actual Supabase stack (GoTrue,
PostgREST, Realtime included), not just plain Postgres.

## Playwright smoke passes — flagged, not resolved

**This bullet does not apply to what Sprint F1 built, and is being said
plainly rather than marked N/A on my own judgement.** CLAUDE.md's stack
line scopes Playwright to UI testing, and the sprint brief's own last line
is explicit: *"Definition of done per CLAUDE.md. No React yet."* There is
no UI in this repository yet — no page, no component, nothing a browser
could smoke-test. Writing a Playwright test against an API-only backend
would be exactly the kind of demo shortcut CLAUDE.md's non-negotiable
rules rule out (a test that doesn't test the thing it claims to), so none
was written.

The honest options are: (a) treat this DoD bullet as not-yet-applicable
until a UI sprint exists, and revisit it then, or (b) decide Sprint F1
needed a different, backend-appropriate substitute for "smoke passes" (for
instance, requiring the integration test suite to have actually run
green in CI before calling the sprint done). This is a real open question,
not a rounding error, and it's surfaced here for confirmation rather than
resolved unilaterally.

## Docs updated

- `docs/SPEC-data-model.md` §5.3 has been updated: it originally sketched
  a single atomic `atlas.commit(envelope)` security-definer function for
  the `change`-branch write path. What step 6 actually built —
  `src/db/commits.ts`'s two-round-trip insert-then-compare-and-swap,
  backed by the `atlas.guard_branch_head_advance` trigger added in
  `20260906071800_branch_head_advance.sql` — is a deliberately different,
  simpler design for this product's actual contention level, and the spec
  now says so, including the accepted orphaned-commit tradeoff and the
  atomic-procedure path named as the future optimisation if that ever
  stops being true.
- `merge.ts`'s own header comment already documents its identity-matching
  approximation (`identity` uses exact normalised name+type+context,
  narrower than §8 rule 3's trigram similarity; `identity:strong` needs an
  optional `aliasesByElementId` the caller may not supply yet) and
  cross-references §8 directly — checked against the spec during this
  review and found already consistent, so no change was needed there.
- The CI workflow's `database` job comment was already corrected in step 6
  to stop claiming "no integration tests exist yet."
- This document (`docs/SPRINT-F1-STATUS.md`) is itself new, written for
  this review.

## No known data-loss path

Audited across migrations and application code as part of this review:

- **No raw `DELETE`/`TRUNCATE`/`DROP TABLE` exists anywhere in
  `supabase/migrations` or `src/db`.** The only `.delete()` calls in the
  repository are (a) `repository.integration.test.ts`'s `afterAll`
  cleanup, deliberately deleting only the test organisation and test
  users it created, and (b) in-memory `Map.delete`/`Reflect.deleteProperty`
  calls inside the engine's own `Head` bookkeeping (`src/engine/deltas.ts`)
  and a property test — never a database call, and consistent with
  "retract" being a new delta, not a deletion of history.
- **`on delete cascade`** appears on four foreign keys: `elements_head`/
  `relationships_head` → `commits`, `branches` → `models`, and `members` →
  `organisations`/`auth.users`. None of these are reachable from any
  exposed application code path today — there is no "delete an
  organisation" or "delete a model" operation anywhere in `src/db`. They
  exist purely as referential-integrity backstops for tenant/user
  offboarding work that does not exist yet, and their effect (removing a
  projection or membership row, never a `delta`) is consistent with
  "no delete without a delta": deleting an entire organisation is
  offboarding a tenant, not erasing a fact within one.
- **The one accepted, already-documented risk** is `src/db/commits.ts`'s
  orphaned-commit tradeoff, re-verified above: a lost CAS race or a
  deltas-insert failure after a successful commit insert leaves a commit
  row that no branch ever points to and no fold ever reaches. This is
  harmless by construction (nothing reads an unreferenced commit) rather
  than a loss of any committed fact, and is written down as an accepted,
  reviewed risk in both `commits.ts`'s module comment and
  `SPEC-data-model.md` §5.3, with a named future fix (a single
  security-definer procedure) if this product's contention ever grows
  past "one or two architects on a branch at a time."
- **One coverage gap, not a known defect:** repeated retract/restore
  cycles on the same subject across many commits are exercised by the
  property tests but not stress-tested at scale; nothing found during this
  review suggests a problem, and it is named here rather than silently
  assumed fine.

## Summary

Four of five bullets are true and were freshly re-verified in this review:
tests green (94/94 unit and property; integration tests written and
SQL-mechanics-verified but not executed here, for the sandbox reason
above), migration applied fresh from zero (re-run twice, plus a full
cross-table smoke test and three negative-path checks), docs updated (one
real gap found and fixed), and no known data-loss path (audited; one
already-accepted, documented risk; no new ones found). The fifth —
Playwright smoke — does not fit a sprint with no UI, and is surfaced above
for a decision rather than quietly marked done or skipped.
