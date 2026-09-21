# Sprint F6 — value streams: status, item by item

F6's own closing line (`docs/prompts/atlas-prompt-pack.md`, "### F6"): one taxonomy addition — a `value_stream` element type (streams and stages, two levels, ordered by `order`) plus one `enables` relationship (capability → stage) — governed by ADR-023 (`docs/ADR-023-value-streams.md`), with everything downstream hanging off that one decision. This is the sprint's summary, in `docs/SPRINT-S1-STATUS.md`'s format.

Steps 1–5 shipped as PRs [#271](https://github.com/sparky100/atlas/pull/271) and [#279](https://github.com/sparky100/atlas/pull/279); Steps 6–8 shipped as three local commits (`bfda290`, `1a928f3`, `5dfdac7`); Step 9 (integration test, golden-path Playwright spec, this document) is the closing commit.

## Items

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | ADR-023 (taxonomy, C22, the edit gate, rollup severity order, impact hop, starter content) + docs it amends (ADR-001, SPEC §3.1/§3.3/§3.10/§4/§5.2/§10/§11, prompt pack, `DELIBERATELY_NOT_MODELLED`) | done | `docs/ADR-023-value-streams.md`, `docs/ADR-000-foundations.md`, `docs/SPEC-data-model.md`, `docs/prompts/atlas-prompt-pack.md` |
| 2 | Contract + migration + engine (rule 1, together): `value_stream`/`enables` enums, `ValueStreamAttributes`/`EnablesAttributes`, C22 in `deltas.ts`, the two map tables, `seed_from_map`'s `p_relationships_head`; RT-14/RT-15 | done | `src/contracts/delta.ts`, `src/engine/deltas.ts`, `supabase/migrations/20260921070000_value_streams.sql`; `src/db/valueStreams.integration.test.ts`, `src/db/capabilityMapValueStreams.integration.test.ts` |
| 3 | Rollup and impact hop | done | `src/ui/valueStreams/valueStreamRollup.ts` (P-34), `src/ui/valueStreams/impactTraversal.ts`, `src/db/changeSummary.ts`'s `affectedValueStreams`, `src/ui/decisions/compareOptions.ts` |
| 4 | Value streams page + element page + mobile + nav | done | `src/ui/routes/ValueStreamsPage.tsx`, `ValueStreamsView.tsx`, `ValueStreamsMobileList.tsx`, `ElementPage.tsx`'s stage/stream handling |
| 5 | Editing and the gate (`canEditValueStreamStructure`, `ValueStreamGateNotice`, search-first add, reorder, `enables` picker) | done | `src/ui/orgs/roleGates.ts`, `src/ui/components/ValueStreamGateNotice/`, `src/ui/components/ReorderButtons/` |
| 6 | Director "By outcome" toggle, roadmap `?groupBy=`, capability map "enables N stages" + "Stream · Stage" | done | `DirectorHome.tsx`, `ValueStreamsOutcomeView.tsx`, `roadmapLifecycleRows.ts`'s `groupBarsByValueStream`, `CapabilityMapView.tsx` |
| 7 | Starter content + loader/review/export/seed round-trip | done | `capabilityMapContent.ts`'s `valueStreams`, `loadCapabilityMaps.ts`, `reviewCapabilityMaps.ts`, `exportCapabilityMap.ts`, `seedFromMap.ts`; 8 new content versions (`content/capability-maps/*`) |
| 8 | JSON import (`value_streams` section → `correct`-intent branch) | done | `importValueStreamRow.ts`, `parseImportJson.ts`, `matchImportRows.ts`'s `matchImportValueStreams`, `buildImportCommit.ts`, `useSpreadsheetImport.ts` |
| 9 | Integration test + golden-path Playwright spec + this status doc | done (written; not run — see below) | `src/db/valueStreams.integration.test.ts`'s rollup/impact describe, `e2e/golden-path-value-streams.spec.ts` |

## Suites (per commit, run fresh on each — not "green last time")

- `pnpm lint` / `pnpm exec tsc --noEmit` — clean on Steps 6, 7, 8, 9.
- `pnpm test` (unit + property) — green: 2015 (Step 6), 2037 (Step 7), 2056 (Step 8). One flaky `src/capture/runCapture.test.ts` PDF case failed once during Step 7/8 runs and passed on re-run (passes in isolation; unrelated to F6 — see "cannot honestly call done").
- `pnpm build` — clean on Steps 6, 7, 8.
- `pnpm check:case-collisions` — clean on Steps 6, 7, 8.
- `pnpm db:reset` / `pnpm test:integration` — **not run.** Docker/Supabase is unavailable in the authoring sandbox (the same limitation `playwright.config.ts` and every `*.integration.test.ts` document). The F6 integration tests (`valueStreams`, `capabilityMapValueStreams`, the `value_streams` case in `spreadsheetImport`) are written but unverified against a real Postgres.
- `pnpm exec playwright test` — **not run**, same reason. `e2e/golden-path-value-streams.spec.ts` is written (runs at 1280 and 390) but not exercised.

## What this summary cannot honestly call done

1. **Migration + content release.** The two F6 migrations (`20260921070000_value_streams.sql`, `20260921080000_export_value_streams.sql`) are merged but must be replayed from zero (`pnpm db:reset`) and pushed to the live project (`pnpm release`). The 8 new starter-map versions are written as `draft` and must be loaded + published (`pnpm content:load-capability-maps`, then `pnpm content:publish-capability-map <sector> <version>` for each) — the electricity v4 map in particular must be *published* for `golden-path-value-streams.spec.ts` to seed value streams. None of this runs in the sandbox.
2. **Integration and Playwright suites are unverified.** Written, typecheck-clean, but not executed — per CLAUDE.md's own "a suite that can't run in this sandbox is said so plainly, not reported green," these are reported as not-run, not green. The golden-path spec's viewport-dependent step (the mobile stream accordion) is reasoned about in a comment but needs the real 1280/390 run to confirm.
3. **ADR-023's Status line still reads "Proposed".** It names the moment of acceptance as "when that PR merges to main"; Steps 1–5 merged, so the line should be flipped to Accepted as part of close-out (a one-line edit, left here rather than made silently).
4. **A flaky pre-existing PDF test.** `src/capture/runCapture.test.ts`'s `NO_TEXT_LAYER`/`INPUT_UNREADABLE` cases are PDF-parsing tests that intermittently fail under the full parallel suite and pass in isolation — unrelated to F6 (nothing in F6 touches `src/capture/` PDF parsing), pre-existing, and flagged here rather than glossed over.

## Deferred register (open from this sprint)

- **Custom attributes on value streams** — ADR-023's "Alternatives rejected": `attribute_definitions.applies_to` deliberately not extended (SPEC §11 records the gap).
- **Per-stage owner or timing** — explicitly *not* a gap: the brief rules both out.
- **Value-stream rows on the capability-scoped Landscape / Context view** — no view asks for streams today (ADR-023 "Deferred").
