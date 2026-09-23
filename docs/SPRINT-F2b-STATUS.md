# Sprint F2b — fold F2-lite into K1 capture: status, item by item

F2b's own closing decision (`docs/SPEC-capture.md`'s Sprint F2b amendment note, `docs/prompts/atlas-prompt-pack.md` "### F2b"): the "follow-on decision" left open when K1 (full capture, F2) shipped alongside F2-lite rather than in its place — retire F2-lite, or keep both indefinitely — is made: **retire**. Every gap F2-lite covered that K1 didn't is folded into K1's own design (a mixed system/module sheet, a Relationships sheet, owner-external syntax, pipe-delimited capability lists, JSON as a fourth input format, an always-on "not in file" summary, review-queue bulk-accept), except value-stream import, dropped per ADR-023 rather than carried over (decided with the human, Step 1). This is the sprint's summary, in `docs/SPRINT-F6-STATUS.md`'s format.

Steps 1–7 shipped as seven local commits: `385c51a`, `b28f2fe`, `5b79079`+`5b31417` (Step 3, two parts), `fe7627f`, `0313ffe`, `85ae5f7`, and this document's own closing commit.

## Items

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | SPEC-capture.md/ADR-023 amendment (docs only) — the reconciliation table, the two decisions put to the human (value streams dropped; JSON confidence capped at 0.90, not defaulted to 1.0) | done | `docs/SPEC-capture.md`, `docs/ADR-023-value-streams.md`, `docs/prompts/atlas-prompt-pack.md` |
| 2 | Contract + round-trip tests: `RunCaptureSource.format` gains `'json'`, `CandidateEvidence.extractor` gains `'json-authored'` | done | `src/contracts/capture.ts`, `src/contracts/capture.property.test.ts` |
| 3 | Parsing/matching: per-row mixed system/module split, owner `"Name (External: Org)"` syntax, `|`-delimited capability lists, a dedicated Relationships sheet, JSON dispatch (`runJsonCapture`) | done | `src/capture/rowsToCandidates.ts`, `normaliseValue.ts`, `capabilityAssignment.ts`, `relationshipSheetToCandidates.ts` (new), `runCapture.ts` |
| 4 | Retire/restore candidates (`changes` section, `mustMatchExisting`) + `replaced_by` supports-edge transfer at promotion | done | `runCapture.ts`'s `buildJsonChangeCandidates`, `buildPromotionEnvelope.ts` |
| 5 | Review queue: bulk-accept (`x`/`a`) widened to `confirm`+`new`; unconditional "not in file" (not gated on re-import) | done | `CaptureReviewView.tsx`, `CaptureCandidateRow.tsx`, `useCaptureReviewQueue.ts`, `notInFile.ts` |
| 6 | Retire F2-lite: delete its exclusive files, repoint Elements/Landscape "Import…" at K1's own Capture section, add `.json` support to `UploadCaptureDialog.tsx` and the `capture-run` edge function's `downloadInput()`, prune `value_streams` remnants from `parseImportFile.ts`/`parseImportJson.ts`/`importPromptSchema.ts` | done | `85ae5f7`; deletions of `SpreadsheetImportDialog.tsx`, `useSpreadsheetImport.ts`, `matchImportRows.ts`, `buildImportCommit.ts`, `importTemplate.ts`/`importTemplateXlsx.ts`, `importValueStreamRow.ts` and their tests |
| 7 | Fixtures 11–12, `pipeline.integration.test.ts` extended to fixture 12, golden-path Playwright extended, two bugs found and fixed while authoring the fixtures, this status doc | done (fixtures/unit tests run and green; integration/Playwright written, not executed — see below) | `src/capture/fixtures/11-mixed-sheet-relationships/`, `12-json-retire-restore/`; `src/capture/fixtures.test.ts`; `src/capture/pipeline.integration.test.ts`; `e2e/golden-path-capture-review.spec.ts` |

## Two bugs found authoring Step 7's own fixtures — "the fixtures are the test"

Building fixture 11 (a mixed system/module sheet through the *real* `runCapture()` pipeline, not `rowsToCandidates.ts` called directly) surfaced that Step 3's own mixed-sheet feature was unreachable: `inferSheetType` forced `sheetType: 'container'` at the sheet level whenever a `parent` column was mapped, before `rowsToCandidates.ts` ever got a chance to decide per row — so its own `sheetType === 'system' && raw !== ''` branch could never run through the real dispatch path, only through a test calling it directly with a hand-forced `sheetType`. Fixed by dropping `hasParentColumn` as an independent trigger in `inferSheetType` (a container-named sheet is still always `container`; a plain sheet with a parent column now stays `system`, deferring to the per-row split) — `src/capture/runCapture.ts`, with a new end-to-end regression test in `runCapture.test.ts` (`describe('runCapture — mixed system/module sheet ...')`) covering both the mixed case and the "every row fills parent" case that already worked before.

Building fixture 12 (a JSON `changes`-section retire/restore, asserting the confidence cap actually landed) surfaced that `elementCandidateConfidence`'s "min over {name, required attributes for this type}" rule — correct for a `new`/ordinary `update` candidate, which always asserts every required attribute via `applyRequiredDefaults` — floored a `mustMatchExisting` candidate's own top-level `confidence` at 0 regardless of its real `lifecycleStatus` confidence, since that candidate deliberately never asserts `name`/`isExternal`/etc. Not a data-correctness bug (`buildCaptureDraftEnvelope.ts` reads each attribute's own confidence from `evidence.attributeConfidence` directly, never `candidateConf`, so the promoted delta's confidence was always right), but a real review-queue display/sort defect: every retire/restore would have shown 0% confidence. Fixed by having `elementCandidateConfidence` fall back to whatever attributes a `mustMatchExisting` candidate actually populated, the same "no fixed required list" shape `relationshipCandidateConfidence` already used — `src/capture/runCapture.ts`, with a regression test in `runCapture.test.ts` and both amended into `docs/SPEC-capture.md` §5.2/§5.5.

Both are disclosed here rather than folded silently into Step 6/7's own "retire F2-lite" description, since neither is about F2-lite at all — both are pre-existing K1 (Step 3/4) defects this sprint's own fixture-authoring work happened to catch.

## Suites (run fresh on the final commit, not "green last time")

- `pnpm lint` — clean except three pre-existing, unrelated issues reconfirmed via `git stash` at every step of this sprint: `scripts/bundleCaptureRunFunction.ts`'s missing `esbuild` type declarations (a sandbox gap), two lint errors in `src/capture/ground.ts`, one unused-eslint-disable warning in `src/db/captureJobs.ts`.
- `pnpm exec tsc --noEmit` — clean (same `bundleCaptureRunFunction.ts` gap, filtered).
- `pnpm test` (unit + property) — green: 2047 tests across 179 files on the final commit.
- `pnpm build` — clean.
- `pnpm check:case-collisions` — clean.
- `pnpm db:start && pnpm db:reset && pnpm test:integration` — **not run.** Docker/Supabase is unavailable in this sandbox, the same standing limitation disclosed at every step of this sprint and every prior one. `pipeline.integration.test.ts`'s new fixture-12 case (a JSON `changes`-section promotion through a real `write_capture_draft`/`apply_capture_decisions` round trip) is written, typecheck-clean, and reasoned through, but unverified against a real Postgres.
- `pnpm exec playwright test` — **not run**, same reason. `e2e/golden-path-capture-review.spec.ts`'s new third test (JSON upload, bulk-accept via `x`/`a`, apply) and the two label-text fixes it needed (`UploadCaptureDialog.tsx`'s accessible name widened to mention JSON in Step 6) are written but not exercised at 1280 or 390.

## What this summary cannot honestly call done

1. **Integration and Playwright suites are unverified.** Written and typecheck/lint-clean, but not executed — reported as not-run, not green, per CLAUDE.md's own standard for a suite that can't run in this sandbox.
2. **Fixture 12's `replaced_by` supports-edge transfer is not itself exercised by fixture 12.** `buildPromotionEnvelope.ts`'s own transfer logic (Step 4) is unit-tested directly in `buildPromotionEnvelope.test.ts`; fixture 12's own `Legacy CRM` has no pre-existing live `supports` edge for the promotion step to transfer, so `pipeline.integration.test.ts`'s new fixture-12 case exercises the retire/restore/`replaces` *candidate* shape for real, not the edge-transfer's own real-DB path specifically. Recorded here as a known, narrower scope rather than implied coverage it doesn't have.
3. **Released, not yet.** This sprint ships no migration — nothing to `pnpm db:reset`/`pnpm release`. The app itself deploys on push to `main` via Cloudflare Workers Builds, same as every other sprint.

## Deferred register (open from this sprint)

- **Value-stream import** — deliberately dropped, not deferred. ADR-023's own "capture never proposes a value stream or stage" now holds without exception; a value stream is edited only through the element pages.
- **`docs/import/PROMPT.md` rewrite** — turned out unnecessary: the prompt already described the three-array (`systems`/`relationships`/`changes`) JSON shape with no `value_streams` section, so Step 6 needed no edit there.
- **F2-lite's two bespoke `sources` columns** (`import_touched_element_ids`, `pending_aliases`) — stop being written by any live code path as of Step 6, but stay in the schema per rule 5 (no hard delete of history); historical F2-lite-sourced changes remain valid, and `useImportSummary.ts`/`ChangeView.tsx`'s "Import summary" panel still reads them for that history.
