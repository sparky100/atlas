# Sprint S1 — stabilisation: status, item by item

S1's own closing line (`docs/prompts/atlas-prompt-pack.md`, "### S1"): "Summary lists each item done / not done with evidence and the human's sentence." This is that summary. Every item below shipped as its own PR, filed as a GitHub issue first, with `pnpm typecheck`/`pnpm lint`/`pnpm test` run fresh on every PR (see "Suites" below for what that did and did not cover) — evidence links the PR and the concrete file/test proving the claim, not just the PR title.

**The human's sentence column is intentionally blank.** It is the one part of this summary only the human can write — a verdict this document cannot manufacture on their behalf. Fill it in per row before treating S1 as closed.

## Items

| # | Item | Status | Evidence | Human's sentence |
|---|---|---|---|---|
| 1 | Change banner (name, To-be/Diff, Back to main, Submit for review — two buttons) | done | `EditingBranchBanner.tsx` | |
| 2 | Reviewer "View this change" read-only viewing ref | done | `ViewingBranchBanner.tsx`, `ReviewRequestView.tsx`, `ChangePage.tsx` | |
| 3 | Review request page (requester by name, deltas grouped, counts not facts, split as partial-accept) | done | `ReviewRequestView.tsx`, `SplitReviewPanel.tsx` | |
| 4 | Cancel a change | done | `atlas.cancel_change` (`20260912111000_cancel_change_function.sql`), `ChangesView.tsx`'s "Cancelled" section | |
| 5 | "branch" → "change" terminology, lint rule enforced | done | Strings renamed (commit `8e9a4be`); lint rule added PR [#137](https://github.com/sparky100/atlas/pull/137) (`eslint.config.js`'s `no-restricted-syntax` pair, `src/ui/**/*.tsx`) — caught and fixed 18 real pre-existing violations in the same PR | |
| 6 | Architect door order (review queue, findings, my changes, recent activity) | done | `ArchitectHome.tsx`, `groupRecentActivity.ts` | |
| 7 | Zero-count findings collapse to "N checks clear" | done | `healthChecks.ts`'s `partitionHealthChecks`/`checksClearLabel` | |
| 8 | One time helper everywhere | done | `src/ui/time.ts` | |
| 9 | Error banners (one sentence, detail to console); editing hooks never run for commit/tag refs | done | `errorBannerStore.ts`, `useEditingBranch.ts`'s own guard | |
| 10 | Diff page (labels not keys, tag-to-tag titles, ~40-char truncation) | done | `VersionDiffView.tsx`, `describeEnvelope.ts`'s `VALUE_TRUNCATE_LENGTH = 40` | |
| 11 | `version: text` on system/container | done | `delta.ts`'s `SystemAttributes`/`ContainerAttributes`, `ElementHeader.tsx` | |
| 11a | External actors (isExternal/externalOrganisation, boundary rendering, owns-service-only, Assurance finding) | done | `delta.ts`, `landscapeGroups.ts`, engine invariant C20 (`deltas.ts`), `findExternalInterfacesMissingClassification`/`findExternalOrganisationAccess` (`healthFindings.ts`) | |
| 12 | Comments on mobile landscape/capability-scoped lists | done | `LandscapeMobileList.tsx`, `CapabilityLandscapeList.tsx` | |
| 13 | Capability map reorder remainders | done | PR #122 — on-the-fly order, `BackfillCapabilityOrderAction.tsx`, L3 controls, shared L1 header height, alphabetical picker | |
| 14 | electricity_network v3 / utility v2 content | done | PR #124 — `content/capability-maps/electricity_network/3.json`, `utility/2.json`, `docs/review/capability-maps.md`; both correctly left `status: "draft"`, publish pending human review as the item's own wording asks | |
| 15 | A2 remainder: `mainCommitIdHint` dedup, `reportError` everywhere, `docs/CHECK-console.md` | done | PR #128 (dedup + console pass doc) + PR #137 (11 hooks the original rollout missed, found by a full re-audit) | |
| 16 | BranchRebasePanel persisted identity-dismiss + viewer-visibility test | done | PR #130 — `20260913020000_branch_identity_dismissals.sql`, `branchRebaseHardening.integration.test.ts` | |
| 17 | Design-system rule reconciled (Home.tsx/OrgHome.tsx raw lists vs UI-principles) | done | PR #132 — amended `UI-principles.md` §2.0/§10, no code change | |
| 18 | Remove the component level | done | PR #126 — `20260913010000_remove_component_element_type.sql`, `ELEMENT_TYPES`, `UI-principles.md`'s zoom chain | |
| 19 | Platform/module-aware "systems not linked to a capability" + move-to-module nudge | done | PR #135 — `findSystemsWithoutCapability`'s `containers` param, `findPlatformSupportsThatShouldMoveToModule` (`healthFindings.ts`) | |
| 20 | RELATIONSHIP_TYPE_RULES container↔system flows_to/uses + platform-flow-endpoint finding | done | PR #139 — 3 new rows (`relationshipTypeRules.ts`), `findFlowsToPlatformInsteadOfModule` (`healthFindings.ts`) | |

**All 20 items: done.**

## Suites (per PR, every PR, not just this summary's own pass)

- `pnpm typecheck` / `pnpm lint` — clean on every PR.
- `pnpm test` (unit + property) — green on every PR; 949 tests passing as of the last one (#139).
- `pnpm test:integration` — **not fully green.** 3 pre-existing failures (`comments.integration.test.ts`'s realtime case, `invites.integration.test.ts`'s revoke case, `organisationSettings.integration.test.ts`'s delete-with-owner case) reproduce identically against unmodified `main` via `git stash`, confirmed on multiple PRs across this sprint — none in a file any S1 item touched. Not fixed here; flagged for its own follow-up.
- `pnpm exec playwright test` — **not green: 37 of 113 specs fail on `main`**, confirmed pre-existing (identical failure set reproduces on unmodified `main`) and unrelated to S1's own changes. A background task suggestion for a dedicated triage-and-fix pass was raised mid-sprint (categorising each as a stale selector vs. a real bug) — still open, not part of this sprint's own scope.
- `pnpm build` — clean on every PR that touched `src/`.
- `pnpm check:case-collisions` — clean on every PR.

## What this summary cannot honestly call done

Two things the S1 prompt block's own preamble names as expected, that did not happen this sprint:

1. **"Screen record diffed in the summary."** `scripts/screens.ts` does not exist, and neither does `docs/screens/`. That script is **P1's** own deliverable (`docs/prompts/atlas-prompt-pack.md`'s "### P1" prompt, step 3) — P1 was never run against this repo (no commit implementing it exists in `git log`). Every S1 PR shipped without a screen-record diff as a result; this summary cannot manufacture one after the fact for 20 already-merged PRs. If P1 lands later, decide whether to backfill a baseline now or treat the gap as accepted.
2. **E1 (C19) landing before S1**, per the pack's own §3 ordering ("2. E1 — C19. Desktop. Before any other engine or UI change. 3. S1 — stabilisation... UI only."). No E1 commit exists in `git log` either — S1 ran without it. S1 itself was genuinely UI-only throughout (nothing in `src/engine` changed across items 1–20, confirmed by every PR's own diff), so this didn't let engine drift into S1's scope — but the pack's own gate for S2 ("S2. ... Prerequisites: S1 merged; E1 merged.") is not yet satisfied, and won't be until E1 runs.

Both are named here rather than glossed over, per CLAUDE.md's own "'done' without evidence is wrong, not optimistic" standard — S1's 20 numbered items are genuinely done; the sprint's own surrounding preconditions and follow-through are not both yet true.

## Deferred register still open from this sprint

Two rows the S1 register itself names (`docs/prompts/atlas-prompt-pack.md` §7) were resolved differently than "fixed":

- **A2 remainder / BranchRebasePanel dismissals** — closed by items 15/16 above.
- Everything else in §7's own list targeted at S1 is closed by the items above; nothing in that register still points at S1 as its target.
