# Sprint F4 — duplicates report: status, item by item

F4's own closing decision (`docs/ADR-000-foundations.md`'s "Amended (F4, ...)" paragraph, `docs/prompts/atlas-prompt-pack.md` "### F4"): ADR-019 named "the standing duplicates report" as a deferred half of its identity policy but left five build decisions unanswered — this sprint answered them first, then built against the answer. Detection needs no LLM or edge function at all (unlike capture/K1): it's a single Postgres RPC combining `pg_trgm` name/alias similarity with corroborating signals already defined for the in-memory merge matcher. The on-demand "Check now" path is primary; the nightly `pg_cron` sweep is a secondary, separately-shipped enhancement over the identical detection code, so the feature was useful the moment Step 5 shipped rather than being gated on `pg_cron`'s own availability. This is the sprint's summary, in `docs/SPRINT-F6-STATUS.md`'s format.

Steps 1–6 shipped as PR [#297](https://github.com/sparky100/atlas/pull/297) (squash commit `f8bc4f5`); Steps 7–8 shipped as local commits on a branch restarted from `main` after that PR merged (the same PR-already-merged restart this sprint's own Step 6 turn hit once before), this document's own commit closing Step 8.

## Items

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | ADR-019 amendment (docs only) — five build decisions recorded before any code: detection as a Postgres RPC; the `%`-operator trigram gate + corroborating signals; three tables as non-rule-5-protected operational tooling; the per-model toggle as a plain grant; on-demand-primary/`pg_cron`-secondary | done | `docs/ADR-000-foundations.md`'s "Amended (F4, ...)" paragraph, `docs/prompts/atlas-prompt-pack.md` |
| 2 | Schema: `duplicate_check_runs`/`duplicate_candidates`/`duplicate_dismissals` (member-scoped select, no `authenticated` write grant at all) + `models.duplicates_check_enabled` (default `false`) | done | `supabase/migrations/20260924010000_duplicates_schema.sql`, `src/db/types.ts`, `docs/SPEC-data-model.md` §3.7 |
| 3 | Detection + dismiss RPCs: `atlas.run_duplicate_check` (trigram gate, corroborating signals, documented/tunable scoring, upsert + prune, an atomic one-running-check-per-model guard via a partial unique index) and `atlas.dismiss_duplicate_pair` (idempotent) | done | `supabase/migrations/20260924020000_duplicate_check_rpcs.sql` |
| 4 | Client + hooks: typed wrappers, `useDuplicateCheck` (mirrors `useCaptureJobs`' polling shape) | done | `src/db/duplicates.ts`, `src/ui/duplicates/useDuplicateCheck.ts` |
| 5 | UI: the `/duplicates` report route, "Merge into…" URL-prefill (`mergePrefill.ts`, matching `decisionPrefill.ts`) wired into `MergeIntoAction`/`ElementPage.tsx`, two new role gates, Architect Home's `duplicatesCount` widened from a permanent `0` placeholder to a real 5th stat | done | `src/ui/duplicates/DuplicatesReportView.tsx`, `DuplicatesReportPage.tsx`, `mergePrefill.ts`, `src/ui/orgs/roleGates.ts`, `src/ui/home/ArchitectHome.tsx` |
| 6 | pg_cron nightly sweep (secondary): `atlas.run_scheduled_duplicate_checks()` (never client-callable, per-model failure isolation), daily `cron.schedule` | done | `supabase/migrations/20260924030000_scheduled_duplicate_checks.sql` |
| 7 | Tests: a real defect found and fixed (below), the merge-auto-exclusion integration scenario, the golden-path Playwright spec | done (written; not run — see below) | `src/db/duplicates.integration.test.ts`, `e2e/golden-path-duplicates-report.spec.ts` |
| 8 | Close-out docs | done | `docs/prompts/atlas-prompt-pack.md`, `docs/ADR-000-foundations.md`, this document |

## A real defect found writing Step 7's own tests

ADR-019's own "Amended (F4, ...)" paragraph (item 3) had already promised, before Step 5 was even built, that "a merged-away or retracted element silently drops its `duplicate_candidates` row out of the report the same way it would out of any other query joined to `elements_head` at main's current head — no cleanup RPC exists or is needed." Step 5's actual `listDuplicateCandidates` never did that join at all — it was a bare `select * from duplicate_candidates`, so a pair naming an element merged away between checks would keep showing in the report (and in the architect door's own `duplicatesCount` stat) until someone happened to press "Check now" again, contradicting the ADR outright.

Caught while writing Step 7's own merge-auto-exclusion test, which is exactly what it's supposed to catch. Fixed in the same commit: `listDuplicateCandidates` now takes a `commitId` and filters candidates against `getElementsByIds` (the same rule-8 "no unbounded `.in()`" reference shape that function's own module comment names), returning the resolved element map alongside the filtered rows so `DuplicatesReportView`/`useArchitectHomeInsights` get display names for free instead of a second identical `elements_head` scan. `src/db/duplicates.ts`, `src/ui/duplicates/useDuplicateCheck.ts`, `src/ui/duplicates/DuplicatesReportView.tsx`, `src/ui/home/useArchitectHomeInsights.ts`.

A second, smaller thing found the same way: the architect door's own new stat (`ArchitectHome.tsx`) wrapped only the number in its `Link`, giving it an unstable, count-dependent accessible name and a needlessly small click target. Widened to wrap the whole "N duplicates flagged" phrase.

## Suites (run fresh on the final commit, not "green last time")

- `pnpm lint` — clean except three pre-existing, unrelated issues reconfirmed at every step of this sprint: `scripts/bundleCaptureRunFunction.ts`'s missing `esbuild` type declarations (a sandbox gap), two lint errors in `src/capture/ground.ts`, one unused-eslint-disable warning in `src/db/captureJobs.ts`.
- `pnpm exec tsc --noEmit` — clean (same `bundleCaptureRunFunction.ts` gap, filtered).
- `pnpm test` (unit + property) — green: 2073 tests across 181 files on the final commit.
- `pnpm build` — clean.
- `pnpm check:case-collisions` — clean.
- `pnpm db:start && pnpm db:reset && pnpm test:integration` — **not run.** Docker/Supabase is unavailable in this authoring sandbox, the same standing limitation disclosed at every step of this sprint and every prior one. `duplicates.integration.test.ts`'s three describe blocks (schema/RLS, the detection/dismiss RPCs, the real-merge auto-exclusion) are written, typecheck-clean, and reasoned through against the real RLS/RPC behaviour, but unverified against a real Postgres.
- `pnpm exec playwright test` — **not run**, same reason. `e2e/golden-path-duplicates-report.spec.ts` is written (runs at 1280 and 390) but not exercised.

## What this summary cannot honestly call done

1. **Integration and Playwright suites are unverified.** Written, typecheck/lint-clean, and reasoned through, but not executed — reported as not-run, not green, per CLAUDE.md's own standard for a suite that can't run in this sandbox.
2. **The pg_cron sweep has never actually fired.** The migration creates the `cron.job` row (`atlas-nightly-duplicate-check`, 03:00 UTC daily) and the schema/RPC/UI were all confirmed working through the on-demand path, but nobody has confirmed a scheduled run has executed successfully on the live project — `cron.job_run_details` is worth checking after the first scheduled window passes. The on-demand "Check now" path this sprint's own golden path exercises is unaffected either way.
3. **Migration release — resolved, not a gap.** Unlike every other sprint this format has covered, this one doesn't end with "must still be pushed to the live project": a mid-sprint check found the live "Architecture" project had fallen five migrations behind `main` (including two unrelated ones from a prior, already-merged PR — the deploy workflow's own automatic backstop had been failing on every run for several days), and a later check confirmed all 105 migrations, including this sprint's three, are now applied live. Recorded here for the record, not left implicit.
4. **The v1 scope limit is a decision, not a gap**, but worth restating plainly: a contributor can dismiss a pair from the report but never merge one from it (main-only edit gate); they can still merge the ordinary way from their own change branch. Un-dismissing a pair also isn't offered in v1 — `duplicate_dismissals` isn't rule-5-protected, so adding that later is an ordinary feature addition, not a design change.

## Deferred register (open from this sprint)

- **Capability/actor duplication** — v1 scope is `system`/`container` only (ADR-000's "Amended (F4, ...)" item 2); a different, lower-value conversation this build didn't take on.
- **Un-dismissing a pair** — no precedent, small and clearly-scoped; not rule-5-protected, so a future owner-only undo RPC is a legitimate addition, not a design change.
- **Contributor merge from the report** — the report is main-scoped and `canEditOnMain` gates merging there to owner/architect; a contributor's own change-branch merge path is unaffected.
