# SPEC: Capture pipeline

**Status:** Built (PR1–PR16, 2026-09-20); **F2-lite folded in and retired (Sprint F2b, 2026-09-23, Steps 1–7 done — `docs/SPRINT-F2b-STATUS.md`)**. **History:** originally Proposed (Prompt 10, 2026-09-11). **Amended 2026-09-20 (mid-build):** "F2-lite" (#198–#204, #209, shipped 2026-09-18) had already implemented a narrower slice of this design — deterministic spreadsheet/CSV/JSON reconciliation against a fixed column schema, matched against main and folded into one commit on an ordinary change branch — outside this spec's own table/edge-function/candidate shape, and was never reconciled back into it at the time. **PR1–PR16 (2026-09-20) then built the full design this document describes, alongside F2-lite rather than in its place**: `src/ui/import/SpreadsheetImportDialog.tsx` (F2-lite's own upload dialog, reachable from the Elements page toolbar) was untouched and, until F2b, still the only path for F2-lite's own deterministic reconciliation flow. §15 records what, if anything, is still genuinely deferred past PR16.

**Amended 2026-09-23 (Sprint F2b — F2-lite retired, folded into K1):** the "follow-on decision" the note above named — retire F2-lite in favour of K1's own upload flow, or keep both — is now made: **retire**. Every gap F2-lite covered that K1 didn't is folded into this document below (a mixed system/module sheet via a per-row `parent`-column split in §5.2; a dedicated Relationships sheet in §5.2a; the owner `"Name (External: Org)"` syntax and the `capability` column's `|`-delimited literal list in §5.2; JSON as a fourth input format in §5.6; an always-available "not in file" summary in §9.4; bulk-accept in the review queue in §10), except one: **value-stream import is dropped, not carried over.** ADR-023 already states, deliberately, "capture never proposes a value stream or stage — the layer is edited on main or in a correction only"; F2-lite's JSON `value_streams` section contradicted that from the day F6 shipped, and folding it into K1 rather than dropping it would have meant carving an exception into an ADR written the same sprint for the opposite reason. Decided with the human rather than picked silently. `src/ui/import/SpreadsheetImportDialog.tsx` and the rest of F2-lite's own exclusive files are now removed (F2b's own Step 6): `useSpreadsheetImport.ts`, `matchImportRows.ts`, `buildImportCommit.ts`, `importTemplate.ts`/`importTemplateXlsx.ts`, `importValueStreamRow.ts`, and the F2-lite-only tests. The Elements-page toolbar and Landscape empty-state "Import…" actions now navigate to the model's Capture section instead of opening that dialog; `UploadCaptureDialog.tsx` and the `capture-run` edge function's own `downloadInput()` gained `.json` file support so the JSON path this fold-in relies on has a real upload route. `parseImportFile.ts`/`parseImportJson.ts`/`importPromptSchema.ts` are pruned of the now-dead `parseImportFile()` reader and the `value_streams` section. `docs/import/PROMPT.md` needed no changes — it already described the three-array JSON shape without a `value_streams` section.
**Depends on:** `docs/ADR-000-foundations.md` (ADR-001, ADR-004, ADR-007, ADR-008, ADR-014, ADR-015, ADR-019), `docs/SPEC-data-model.md` (§3.6 `sources`/`aliases`, §3.7 `capture_jobs`, §4 delta format, §5.3 who writes commits, §6.3 validation levels, §8 matching), `docs/UI-principles.md` §4.3 (provenance badge), §5 (review queue).
**Builds:** Sprint K1 (Prompt 11). Built — the pipeline passes §12's fixtures (01–07 fully; 08/10 with hand-authored cassettes; 09 replay-only by its own nature — `NO_TEXT_LAYER` fails before any LLM call; see `src/capture/fixtures/README.md` for the disclosed scope of what a hand-authored cassette can and can't stand in for). §13's own integration suites and `e2e/golden-path-capture-review.spec.ts` are written and reasoned through but not executed in this sandbox — no Docker/Supabase route here, the same standing limitation disclosed for every PR in this build; `pnpm db:start && pnpm test:integration` and `pnpm exec playwright test` run them for real.

This document turns ADR-004 ("capture lands as draft branches"), ADR-007 (fact-level provenance) and SPEC §8 (matching) into a contract, prompts, algorithms and an evaluation harness precise enough to build and score against. Like `SPEC-data-model.md`, it contains no engine code: TypeScript is types only, SQL is DDL-shaped, algorithms are pseudocode. Where the ADR or the data-model spec left a choice open, this document makes it, and every such choice is listed in §1 so it can be challenged in one place. Four of them touch the schema or an ADR and are collected again in §14 as questions for the human — the design proceeds under the stated recommendation for each, and none is silently invented.

---

## 1. Decisions made by this spec

| # | Choice | Why |
|---|---|---|
| K-1 | **One `sources` row per capture run, of kind `capture_job`** (the migrated shape, `sources.capture_job_id` not null iff `kind = 'capture_job'`). `name` is the document's own name ("Applications 2026-Q3.xlsx"), `uri` its storage pointer, `captured_at` the date the document was produced (asked of the user at upload; defaults to the file's modified date). Every delta a run produces points at this row. `spreadsheet`/`document`/`interview` remain the kinds a *person* records when transcribing by hand. | ADR-004 says a capture delta's source is the ingestion job; SPEC §3.6 already migrated the row shape and CHECK for exactly that. A provenance badge therefore reads `⚙` for anything machine-extracted and `▤`/`▣` for anything a human typed in from a document — a distinction worth keeping visible. (UI-principles §4.3's worked example shows a spreadsheet-sourced `Vendor` as `▤ 14mo · ●●○`; under this decision a captured vendor reads `⚙ 14mo · ●●○` — a one-glyph doc correction for UI-principles, not a schema change.) |
| K-2 | **A `capture_candidates` table** holds the per-candidate record: proposal, evidence, match outcome, class, confidence, the draft deltas it produced, the reviewer's decision, and what it was promoted as. Function-only writes. | The review queue (UI-principles §5) needs match outcome, similar elements and the source passage *per unit*; a delta row carries only `source_ref`. `capture_jobs.stats` stays a jsonb of counts (SPEC §3.7) — it is a summary, not a place to keep 2,000 candidates. Rule 1: this is a migration + `src/contracts/capture.ts` + a round-trip test, together. |
| K-3 | **Every candidate that can be expressed as a delta is written to the draft branch's single `capture` commit, draft ids included.** `invalid` and `unsourced` candidates (§4.4) get no delta; they exist only as `capture_candidates` rows. | ADR-004: one `capture`-kind commit per draft. A folded draft is what lets `Enter` open "the proposed element page in a peek panel" (UI §5.2) and what lets §10's diff-against-main be an ordinary fold. |
| K-4 | **Promotion re-mints ids.** Accepting a draft `element.create` writes a create with a *fresh* element id on the target change branch; relationship candidates are re-pointed to the promoted ids; `capture_candidates.promoted_subject_id` records the mapping. The draft's ids are dead after promotion. | SPEC C5/P-11: an `element.create` whose id appears in any delta on any branch is rejected. Fighting that invariant to keep one id across draft and change branch would weaken the one rule that makes "id never reused" checkable. |
| K-5 | **A promoted delta keeps the capture provenance** — same `sourceId` (the K-1 row), same `sourceRef`, same `confidence` — and the human review is recorded on `capture_candidates` (`decision`, `decided_by`, `decided_at`) and on the promoting commit's author, never by overwriting the delta's own provenance. `e` (edit before accept) is the one path that writes a human fact: `sourceId` = the reviewer's `manual` source, `confidence = 1.0`, plus a `resolved_conflicts` row discarding the extractor's value (UI §5.2). | ADR-004: promotion "references the human review as corroboration, without overwriting the original capture provenance." ADR-007: human assertion is 1.0 — accepting a plausible extraction is not asserting its truth; editing it is. |
| K-6 | **`confirm` is a candidate class** (§4.4): a matched element whose captured values all equal main's current values still yields an `element.update` per attribute with the same value and the new source. Staged as *accepted* by default, in bulk. | SPEC §7.2: a re-assertion from a newer source is a change to provenance and is carried across. The staleness health chip (UI §3.1, `STALE_AFTER_MONTHS`) is fed by exactly this — a quarterly re-import that confirms 1,800 systems is the evidence that they aren't stale. Cost: one delta per confirmed fact per re-import, accepted at this product's scale. |
| K-7 | **Re-import lineage is `capture_jobs.reimport_of_job_id`** (nullable, → `capture_jobs.id`) plus a per-candidate `row_key` (§9). No separate "document lineage" table. | The diff is between two candidate sets, which `capture_candidates` already holds. A lineage table would be a second identity for something the job chain already expresses. |
| K-8 | **Matching runs against main's head, and optionally the target change branch's folded head.** Never against another draft. Thresholds: trigram ≥ 0.60 matches (SPEC §8); 0.50–0.60 is *similar* (shown, never auto-matched — UI §5.1); two hits within 0.05 of each other, both ≥ 0.60, are `ambiguous`. **Amended, issue #285:** the target-branch half of this row was written but never implemented until this fix — matching only ever read main. Now `runCapture.ts` also matches (name+context only, element candidates only) against a `buildTargetOnlyMatchIndex` of the target branch's own not-yet-on-main elements, when `match.level === 'none'` against main; a hit there is the new `duplicate_in_target` class (§4.4), not an ordinary `update`/`confirm` — the draft branch forks from main, so it has no legal delta to write against something main doesn't know about yet. | SPEC §8 fixed 0.6; UI §5.1 fixed 0.5 for the warning; the margin rule is what SPEC §8's "multiple hits above threshold → flag ambiguous" needs to be decidable. |
| K-9 | **Trigram similarity is implemented in TypeScript, pg_trgm-compatible, and checked against Postgres by an integration test (P-K2).** Postgres is queried through a POST RPC that returns raw hits; classification is pure `src/capture` code. | Rule 6: matching must be reproducible from inputs; §12's fixtures must run in `pnpm test` with no database. The `.in()` ceiling (rule 8) rules out sending 2,000 names as a GET filter — an RPC with a jsonb body is the same shape §9.4's `unresolved_comment_counts` already uses. |
| K-10 | **LLM calls are made only by the `capture-run` edge function**, through the shared LLM proxy (ADR-014) when configured, otherwise directly with the Anthropic SDK behind the same `LlmClient` interface. Model `claude-opus-5` by default (`CAPTURE_MODEL`), structured outputs with a strict JSON schema, no prefill, `refusal` handled as a failure mode. Every response is logged with the job id; every fixture run replays recorded responses. | The browser never holds a key. Rule 6: the model's output is an *input* to the deterministic half of the pipeline, never something the pipeline's determinism rests on — recorded responses make the whole run reproducible, and a live run is scored separately (§12.6). |
| K-11 | **Spreadsheets are extracted deterministically after one LLM call per sheet for column mapping** (and one batched call per 50 rows for capability assignment when a capability-shaped column exists). Row → candidate is code, not a prompt. PDF and pasted text are extracted by the LLM, per chunk, with a mandatory verbatim passage that the pipeline verifies against the extracted text. | A spreadsheet is already structured; asking a model to re-read 2,000 rows is slower, costlier and less reproducible than mapping the columns once. Prose has no structure to exploit, so the model does the reading — but never gets to invent its evidence. |
| K-12 | **The `capture-run` function is step-driven and resumable**: each invocation does bounded work (≤ 60 s), persists `capture_jobs.progress`, and returns `{status: 'continue' | 'parsed' | 'failed'}`; the client re-invokes until done. No scheduler, no background queue. **Narrowed in PR12, agreed with the human directly**: `runCapture()` (PR10/PR11) isn't internally chunked, and today's schema has nowhere to persist a partial candidate set between two invocations — so `src/capture/captureRunStep.ts` implements **job-level retry only**: one invocation runs parse→extract→match→write in full or fails outright (nothing is written until the one atomic `write_capture_draft` call, so a crash loses no data); `progress` still names the running phase but never advances `done`/`total`, and `{status: 'continue'}` is never actually returned. Chunk-level resumability (`progress.done`/`total` advancing mid-extract, matching this row's own original wording and the `RUN_INTERRUPTED` failure mode's "resuming from page 41") is deferred, not built. | Edge-function wall-clock limits make a 200-page PDF or a 5,000-row workbook a multi-invocation job. Persisting progress after every chunk also means a crash loses one chunk, not the run. |
| K-13 | **`supports` proposals default to `role = 'secondary'`; a candidate becomes primary only when the target has no live primary on main *and* the candidate is the first (or only) such edge the row proposes. `owns` proposals get their `role` directly from which header matched them** (`owner` → `business`, `technicalOwner` → `technical`, Prompt 7k item 2) **— never a rank-based default** — a row proposing a second owner of the same role the target already has on main is `conflict`/`update`, not silently retried under a different role. | SPEC C17 rejects a second primary `supports` edge, or a second `owns` edge of the same role on the same target, at fold time, on every branch kind. Capture must never produce a draft commit `commit_deltas` refuses; a reviewer resolves the conflict (promotes to primary, or picks which owner keeps the role) on the element page if they want to. |
| K-14 | **A `gone` candidate (present last run, absent this run) proposes retirement, staged as *undecided*, confidence 0.50.** Systems and modules: `lifecycleStatus = 'retired'` (a module is an element in its own right, Model rule M2; Simon, 2026-11-26, amending the earlier "systems only"); other types: `element.retract`. | Absence from a document is weak evidence — never an automatic retract (rule 5's spirit), never hidden either (UI §4.3: a gap made visible). Confidence 0.50 renders `●○○` so a reviewer sees it for what it is. |
| K-15 | **Edge-function attribute validation imports `src/contracts` directly** (Deno import of the same TypeScript the client uses) rather than waiting for the `type_schemas` JSON-Schema generator. RT-5 stays deferred (SPEC §11). | SPEC §11 named K1's edge function as "the first consumer outside the TypeScript runtime" that would need the generator — but a Deno edge function *is* a TypeScript runtime. Importing the contract removes the need rather than meeting it; the generator can land when a non-TS consumer actually appears. |
| K-16 | **Limits:** 5,000 rows per workbook, 200 pages per PDF, 200,000 characters of pasted text, 50 MB per upload. Over any limit is a failure at upload, not a truncation. | "Don't truncate inputs" — silently capturing 5,000 of 7,000 rows is the decay pattern this product exists to stop. Limits are named so the failure is a stated reason. |

---

## 2. Overview

```
upload / paste ──► capture_jobs (pending) ──► capture-run (service role, stepwise)
                                                 │
                     ┌───────────────────────────┼───────────────────────────┐
                     ▼                           ▼                           ▼
              parse (§5)                  extract (§5, §6)             match (§7)
        rows / pages / text          candidates + passages        exact id → alias → name+context
                     └───────────────────────────┼───────────────────────────┘
                                                 ▼
                                   classify (§4.4) + re-import diff (§9)
                                                 ▼
                          capture_draft branch, one `capture` commit (§8.1)
                          capture_candidates rows, capture_jobs.stats, status = parsed
                                                 ▼
                                review queue, per candidate (§10)
                                                 ▼
                     atlas.apply_capture_decisions → one commit on the target change branch (§8.2)
                                   aliases learned, job status = reviewed
```

Three properties the whole pipeline is built to keep:

1. **Nothing reaches `main` from here.** Output lands on a `capture_draft` branch, is promoted by a human onto a `change` branch, and reaches `main` through the ordinary merge review (ADR-004, ADR-006). Capture never calls `commit_deltas` against `main`, so SPEC §11's "delta-apply in SQL before K1" is not a prerequisite for this sprint — the projection payload it worries about is paid only on `main` commits.
2. **Every fact has a passage.** A candidate with no resolvable `source_ref`, or whose quoted passage cannot be found in the source, is `unsourced` and cannot be accepted until a reviewer attaches a source (UI §5.1: "No source, no accept").
3. **Same inputs, same draft.** Given the same file bytes, the same main head, the same aliases and the same recorded LLM responses, two runs produce the same candidate set in the same order with the same classes and confidences (P-K1). Only ids differ (UUID v7, S-1).

---

## 3. Tables and lifecycle

### 3.1 `sources` — as used by capture

No change to SPEC §3.6. The run's source row is created by the worker at the start of `parse`, before any candidate exists:

| Column | Value |
|---|---|
| `kind` | `capture_job` |
| `name` | the uploaded file's name, or `Pasted text — {first 60 chars}` for text |
| `uri` | `capture-inputs/{org_id}/{model_id}/{job_id}/{filename}` (Storage) |
| `captured_at` | user-supplied "document date" at upload; default: the file's last-modified date if the browser exposes it, else null |
| `capture_job_id` | the job |
| `created_by` | the job's `created_by` (the person who uploaded; the worker acts on their behalf) |

**Lifecycle of a source.** Insert-only (SPEC §9.5). A source is never edited or deleted; a re-import creates a new job and a new source row (K-1, K-7). "How much of this landscape rests on one spreadsheet" is `facts` grouped by `source_id` at main's head — already indexed (`facts (commit_id, source_id)`).

The SPEC §3.6 FK `sources.capture_job_id → capture_jobs(id)` that was left as a plain uuid "until the target exists" is added by this sprint's migration.

### 3.2 `capture_jobs` — amended

SPEC §3.7's columns stand. Added:

| Column | Type | Constraints |
|---|---|---|
| `input_name` | text | not null — original filename, or `pasted-text.txt` |
| `input_sha256` | bytea | not null, 32 bytes — of the stored object; equal hashes on the same model are reported to the user as "identical to job X" but not refused |
| `document_date` | date | nullable — copied onto `sources.captured_at` |
| `reimport_of_job_id` | uuid | → `capture_jobs(id)`, nullable; the previous run of the same document (K-7). Must be the same `model_id`. |
| `target_branch_id` | uuid | → `branches(id)`, nullable; the change branch the reviewer most recently promoted into (UI §5.2 `t`); a convenience default for the next session, not a constraint |
| `progress` | jsonb | nullable — `{stage, done, total, startedAt, updatedAt}`; `stage ∈ parse, extract, match, write` |
| `llm_usage` | jsonb | nullable — `{calls, inputTokens, outputTokens, cacheReadTokens, model}` accumulated per run, for per-org cost attribution (ADR-014) |

`status` keeps SPEC's enum: `pending` (uploaded, not yet run or mid-run — `progress` says which), `parsed` (draft branch written, awaiting review), `reviewed` (every candidate decided, and every non-rejected one applied; the draft is archived), `discarded` (the person threw the whole run away before or after review). `error` is set with a §11 code whenever a run fails; a failed job stays `pending` with `error` non-null and can be retried (a retry clears `error`, re-runs from the last persisted stage).

Transitions, and who makes them:

| From | To | By |
|---|---|---|
| — | `pending` | client insert (RLS: contributor+, `created_by = auth.uid()`) |
| `pending` | `parsed` | `capture-run` (service role) at the end of `write` |
| `parsed` | `reviewed` | `atlas.apply_capture_decisions` when no undecided candidate remains |
| `parsed` | `reviewed` | `atlas.finish_capture_review` (contributor+) when no candidate is undecided and every candidate not yet promoted is `rejected` — no target change, no commit (§8.2, amended 2026-10-06) |
| `pending`/`parsed` | `discarded` | `atlas.discard_capture_job` (contributor+ who created it, or architect/owner) — archives the draft branch (`status = 'archived'`), leaves every row in place |

### 3.3 `capture_candidates` (new, K-2)

One row per thing the pipeline proposed, whether or not it became a delta.

| Column | Type | Constraints |
|---|---|---|
| `job_id` | uuid | → `capture_jobs(id)` on delete cascade |
| `model_id` | uuid | → `models(id)` |
| `seq` | int | not null; `unique (job_id, seq)` — the deterministic order (§4.5) |
| `kind` | subject_type | not null |
| `class` | text | not null, `check (class in ('new','update','confirm','conflict','ambiguous','gone','invalid','unsourced','duplicate_in_target'))` (`duplicate_in_target` amended in, issue #285) |
| `element_type` | element_type | nullable; not null iff `kind = 'element'` |
| `relationship_type` | relationship_type | nullable; not null iff `kind = 'relationship'` |
| `draft_subject_id` | uuid | nullable — the element/relationship id used on the draft branch; null for `invalid`/`unsourced` (no delta) |
| `proposal` | jsonb | not null — `CandidateProposal` (§4.2) |
| `evidence` | jsonb | not null — `CandidateEvidence` (§4.3): source ref, passage, extractor, warnings |
| `match` | jsonb | not null — `MatchOutcome` (§7.5) |
| `confidence` | numeric(3,2) | not null, `check (confidence between 0 and 1)` — the confidence the draft deltas carry |
| `row_key` | text | not null — re-import lineage key (§9.1) |
| `reimport_status` | text | nullable, `check (reimport_status in ('new','changed','unchanged','gone'))`; null when the job has no `reimport_of_job_id` |
| `draft_delta_ids` | uuid[] | not null default `'{}'` — the draft-commit deltas this candidate produced |
| `alias_proposals` | jsonb | not null default `'[]'` — `CaptureAliasProposal[]` (§7.6), amended in by issue #284: shown to the reviewer (§10) before they decide, not only written to `aliases` after |
| `decision` | text | nullable, `check (decision in ('accepted','rejected','merged','edited','split'))` |
| `decision_detail` | jsonb | nullable — for `merged`: `{intoElementId}`; for `edited`: `{attributes}`; for `split`: `{acceptedAttributes[]}` |
| `decided_by` | uuid | nullable |
| `decided_at` | timestamptz | nullable |
| `promoted_commit_id` | uuid | → `commits(id)`, nullable — the change-branch commit the accepted deltas landed in |
| `promoted_subject_id` | uuid | nullable — the re-minted id (K-4), or the matched/merged-into existing id |

Indexes: `(job_id, class)`, `(job_id, decision)` (partial, `where decision is null` — "what's left"), `(model_id, row_key)`, `(org_id)`.

**RLS.** Select: `atlas.has_role(org_id, 'owner','architect','contributor')` — never a viewer (a draft is invisible to viewers, ADR-009, and a candidate row would leak its content). No insert/update/delete policy or grant for `authenticated`: the worker (service role) inserts; `atlas.stage_capture_decisions` and `atlas.apply_capture_decisions` (§8.2) update. Mutable, like `merge_requests` — workflow state, not history; the history is the draft commit and the promoting commit, both append-only.

### 3.4 Storage

Bucket `capture-inputs`, private. Object path `{org_id}/{model_id}/{job_id}/{filename}`. Policies: insert by an authenticated member of `{org_id}` with contributor+ role, path prefix checked against `atlas.member_role`; select by the same; no update; delete only by service role (never in application code — an uploaded document is evidence, kept for as long as the job row exists). Size limit 50 MB (K-16). Pasted text is stored as an object too, so every input kind has a `uri` and the same retention.

### 3.5 Edge function `capture-run`

`supabase/functions/capture-run/index.ts`. Invoked with `{jobId}` by the client (user JWT). The function:

1. Verifies the caller is a contributor+ member of the job's org (reads `capture_jobs` with the caller's JWT — RLS does the check).
2. Switches to the service role for everything after.
3. Runs one bounded step (K-12) according to `progress.stage`, persists `progress`, returns `{status, progress, error?}`.

It imports `src/contracts/*` and `src/capture/*` directly (K-15) — the parsers, prompts, matcher and classifier are the same code the unit tests exercise. `src/db` is *not* imported (it is built around the browser client); the function has its own thin, service-role reads in `supabase/functions/capture-run/db.ts` that follow the same two read rules (`selectAll`-style paging, no growing `.in()`).

**LLM access.** `LlmClient` (`src/capture/llm/client.ts`) has one method, `complete(request): Promise<LlmResponse>`, where `request` is a Messages-API-shaped body. Two implementations, chosen by environment:

- `ProxyLlmClient` — POSTs the body to the deployed `llm-proxy` edge function, `Authorization: Bearer <token>` forwarded (the caller's own session JWT in both cases — directly from the browser, or forwarded through by `capture-run` after its own contributor+ JWT check) and `orgId` in the JSON body, matching the real, already-built E4 contract (`src/contracts/llmProxy.ts`) rather than an earlier `LLM_PROXY_KEY`/`x-atlas-org-id` sketch of it; the proxy is a pass-through to the Messages API, and every call is logged and rate-limited per org (ADR-014).
- `DirectLlmClient` — `@anthropic-ai/sdk` with `ANTHROPIC_API_KEY`. Used when no proxy is configured and by the live evaluation run (§12.6).
- `RecordedLlmClient` — replays `fixtures/**/llm/*.json` keyed by a hash of the request body; throws on a miss. Used by every unit test and by `pnpm capture:score` in replay mode. It is a test double for the network, not a stub for logic (rule 7): the extraction, grounding and matching code paths are identical.

Request defaults, per §6: `model: CAPTURE_MODEL` (default `claude-opus-5`), `max_tokens: 16000`, thinking left at the model's adaptive default, `output_config: { effort, format: { type: 'json_schema', schema } }` with `effort` per prompt, `system` carrying `cache_control: { type: 'ephemeral' }` on the stable block. Streaming for the prose-extraction call (long input). `stop_reason` is checked before `content` is read: `refusal` and `max_tokens` are failure modes (§11), never parsed as partial output.

---

## 4. The candidate contract

Authoritative definition: `src/contracts/capture.ts` (to be written in K1, alongside the migration and RT-K1). Summary:

### 4.1 Source reference

`deltas.source_ref` is text. Capture writes it in one of three grammars, all parsed and formatted by `src/contracts/sourceRef.ts` (bijective — RT-K3):

| Input | Grammar | Example | Rendered (UI §4.3) |
|---|---|---|---|
| spreadsheet / CSV | `sheet:{sheetName}!{A1 range}` | `sheet:Applications!C14`, `sheet:Applications!A14:H14` | `Applications 2026-Q3.xlsx › Applications › C14` |
| PDF | `pdf:p{page}!{startChar}-{endChar}` — offsets into the page's extracted text | `pdf:p7!1203-1288` | `Catalogue.pdf › page 7` |
| pasted text | `text:{startChar}-{endChar}` | `text:120-340` | `Pasted text › chars 120–340` |

A CSV is one sheet whose name is the file's basename without extension. A create delta's `sourceRef` is the row range; each attribute's `sourceRef` (on the create it is implicit — the fact shares the create's ref; on an update it is explicit) is the cell. For prose, every fact's ref is the span of the passage the model quoted.

```ts
export type SourceRef =
  | { kind: 'sheet'; sheet: string; range: string }          // A1 notation, single cell or row range
  | { kind: 'pdf'; page: number; start: number; end: number }
  | { kind: 'text'; start: number; end: number };

export function formatSourceRef(ref: SourceRef): string;
export function parseSourceRef(text: string): SourceRef | null;  // null for a hand-typed ref that isn't in this grammar
```

### 4.2 Proposal

What the extractor believes the document says, in the taxonomy, before matching:

```ts
export type CandidateRef =
  | { kind: 'candidate'; seq: number }        // another candidate in this run (a parent, an endpoint)
  | { kind: 'existing'; elementId: UUID }     // resolved by matching
  | { kind: 'unresolved'; text: string };     // named in the document, matched nothing, no candidate created (→ invalid)

export type ElementProposal<T extends ElementType = ElementType> = {
  kind: 'element';
  elementType: T;
  name: string;
  parent: CandidateRef | null;                // required non-null for container; capability optional; system/actor null
  attributes: Partial<ElementAttributesByType[T]>;   // only keys the document asserts; never defaulted (see §5.4 for the two required-field exceptions)
};

export type RelationshipProposal<R extends RelationshipType = RelationshipType> = {
  kind: 'relationship';
  relationshipType: R;
  from: CandidateRef;
  to: CandidateRef;
  attributes: RelationshipAttributesByType[R];
};

export type CandidateProposal = ElementProposal | RelationshipProposal;
```

### 4.3 Evidence

```ts
export type Extractor = 'sheet-mapping' | 'prose-llm' | 'capability-llm' | 'reimport-diff';

export type CandidateEvidence = {
  sourceRef: SourceRef;
  /** Verbatim text from the source the fact rests on: the row's cells joined with ' | ' for a sheet; the quoted span for prose. Never model-paraphrased. */
  passage: string;
  extractor: Extractor;
  /** Per-attribute refs when they differ from the candidate's own (a sheet row's cells). */
  attributeRefs?: Record<string, SourceRef>;
  /** Per-attribute confidence before matching (§5.5). */
  attributeConfidence: Record<string, number>;
  warnings: EvidenceWarning[];
};

export type EvidenceWarning =
  | { code: 'MERGED_CELL'; cell: string }
  | { code: 'FORMULA_ERROR'; cell: string }
  | { code: 'AMBIGUOUS_DATE'; cell: string; parsedAs: ISODate }
  | { code: 'ENUM_FUZZY'; cell: string; raw: string; parsedAs: string }
  | { code: 'PASSAGE_NORMALISED' }            // found after whitespace/quote normalisation, not byte-exact
  | { code: 'MULTI_VALUE_CELL'; cell: string } // "Civica / Northgate" — split into two candidates, both warned
  | { code: 'LOW_MAPPING_CONFIDENCE'; column: string; confidence: number };
```

### 4.4 Class

Assigned by `classify()` (`src/capture/classify.ts`) from the proposal, the match outcome and main's head:

| Class | Meaning | Draft deltas written | Default staged decision |
|---|---|---|---|
| `new` | No match at any level (§7). | `element.create` (or `relationship.create`) with a draft id | none — reviewer decides |
| `update` | Matched; at least one proposed attribute differs from main's current value, and main's current fact for it is *not* stronger (see `conflict`). | one `element.update` per differing attribute, `previousDeltaId` = main's current fact delta | none |
| `confirm` | Matched; every proposed attribute equals main's current value (deep-equal after normalisation §5.4). | one `element.update` per attribute, same value, new source (K-6) | **accepted** (bulk; reviewer can exclude) |
| `conflict` | Matched; an attribute differs and main's current fact is stronger: its `confidence` ≥ the candidate's for that attribute, **or** its `effective_date` (else its commit date) is later than the source's `captured_at`. | same as `update` | none — rendered as a disagreement (ADR-007) |
| `ambiguous` | Two or more level-3 hits within 0.05 of each other (K-8). Best is proposed. | as `update`/`confirm` against the best hit | none; `a` disabled until a target is chosen |
| `gone` | Re-import only: the previous run had this `row_key`, this run doesn't (§9). | system or module: `element.update lifecycleStatus = 'retired'`; other: `element.retract`; confidence 0.50 (K-14) | none |
| `invalid` | Cannot be a legal delta: unresolved required parent, illegal relationship triple (C9), duplicate `(type, from, to)` already live on main (S-6), required attribute missing and not defaultable, name empty. | **none** | none; `e` is the only path |
| `unsourced` | Grounding failed: the quoted passage isn't in the source, or the ref doesn't resolve. | **none** | none; `e` attaches a source |
| `duplicate_in_target` | **Amended, issue #285 (K-8).** Element candidates only: no match at any level against main, but a name+context match against the job's own target change branch's own folded head (elements it proposes that aren't on main yet — §7.1's fifth bullet). The draft branch always forks from main, so it has no legal delta to write against something only the target branch knows about — this class exists precisely so the pipeline never silently proposes the same element twice across two documents captured into one change. | **none** | none; `r` (reject/dismiss) is the only path — no `e`, nothing to edit into being |

A relationship candidate uses the same classes: `new` (edge not live on main), `confirm` (edge live with equal attributes), `update`/`conflict` (edge live, attributes differ — only `owns.role`, `supports.role`, `flows_to.*`, `uses.via`, `*.description` can differ), `invalid` (C9, C18, S-6, or an endpoint/`via` that is `unresolved`). `duplicate_in_target` is element-only in this build — a relationship candidate can duplicate one already proposed on the target branch too, but that narrower case isn't detected yet (disclosed, not silently dropped: `buildPromotionEnvelope.ts` defensively refuses the class outright for a relationship candidate, since nothing today produces one).

`ambiguous` and `unsourced` take precedence over `update`/`confirm`/`conflict` when they apply; `invalid` takes precedence over everything.

### 4.5 Order

`seq` is deterministic (rule 6): for sheets, by (sheet index, row number, then relationship candidates the row produced in fixed type order `supports, owns, uses, flows_to`); for PDF and text, by (page, passage start offset, then the model's own output order within one passage, which is itself fixed by the recorded response). Ties never occur within one run because every candidate has a distinct source span or row.

### 4.6 Wire ↔ storage

`CaptureCandidate` (the full row: proposal, evidence, match, class, confidence, rowKey, reimportStatus, draftSubjectId, draftDeltaIds, decision…) ↔ `capture_candidates` is a mechanical camelCase/snake_case mapping like SPEC §4.4; jsonb columns keep camelCase keys. RT-K2 is the round trip.

---

## 5. Extraction

### 5.1 Common: parse stage

| Input kind | Parser | Produces |
|---|---|---|
| `.xlsx`, `.xlsm` | SheetJS (`xlsx`, community build, pinned) in the edge function | per sheet: header row candidates, rows as `string[]` with A1 addresses, merged-range list, formula-error cells |
| `.csv`, `.tsv` | own parser (RFC 4180, BOM-tolerant, delimiter sniffed from the first 20 lines) | one sheet |
| `.pdf` | `pdfjs-dist` text extraction per page, reading order by (y, x) with a line-join heuristic | per page: text, char offsets; a page with < 20 non-whitespace characters is flagged `NO_TEXT` |
| pasted text | none | one text |

A workbook over 5,000 data rows, a PDF over 200 pages, text over 200,000 chars → `INPUT_TOO_LARGE` (K-16). A PDF where every page is `NO_TEXT` → `NO_TEXT_LAYER` (scanned; OCR is out of scope for K1 — §15). A password-protected file → `INPUT_ENCRYPTED`.

### 5.2 Spreadsheet / CSV

**Step 1 — header detection (code).** For each sheet, the header row is the first row within the top 15 that (a) has ≥ 3 non-empty cells, (b) has no cell parseable as a date or number in more than a third of its cells, and (c) is followed by a row with ≥ 2 non-empty cells. Title rows, blank rows and "Generated on…" banners above it are skipped and recorded in the sheet's parse notes. A sheet with no header row is skipped with `SHEET_NO_HEADER` in `stats.sheetsSkipped` — a warning on the job, not a failure, unless every sheet is skipped (`NO_USABLE_SHEET`).

**Step 2 — column mapping (synonyms, then LLM).** Each header is normalised (§7.2) and looked up in `src/capture/columnSynonyms.ts`, a checked-in table mapping header tokens to a *column role*:

| Role | Maps to | Example headers |
|---|---|---|
| `atlasId` | exact-id match (§7.3 level 1) | `atlas_id`, `Atlas ID` (the export writes this exact header) |
| `sourceKey` | alias of type `source_system_key` | `Asset ID`, `App ID`, `Ref`, `CMDB ID`, `Application number` |
| `name` | `element.name` | `Application`, `System`, `Application name`, `Product`, `Solution` |
| `description` | `attributes.description` | `Description`, `Purpose`, `What it does` |
| `vendor` | `System.vendor` | `Supplier`, `Vendor`, `Provider`, `Manufacturer` |
| `lifecycleStatus` | `System.lifecycleStatus` | `Status`, `Lifecycle`, `State`, `Live?` |
| `introduced` | `System.introduced` / `Container.introduced` | `Go-live`, `Implemented`, `Start date`, `In service since` |
| `plannedEnd` | `plannedEnd` | `End of life`, `Contract end`, `Decommission date`, `Retire by` |
| `isExternal` | `isExternal` | `Hosted`, `SaaS?`, `External`, `Internal/External` |
| `externalOrganisation` | `externalOrganisation` | `Operated by`, `Third party` |
| `hostingModel` | `System.hostingModel` (Prompt 7k item 1) | `Hosting model`, `Deployment model`, `On-prem/cloud` |
| `hostingProvider` | `System.hostingProvider` (Prompt 7k item 1; free text, not the closed `hostingModel` set) | `Hosting provider`, `Data centre`, `Cloud provider` |
| `disposition` | `System.disposition` / `Container.disposition` (F11, TIME; values fuzzy-matched by `parseDisposition`: T/I/M/E, retain/keep, grow, replace, retire…; anything ambiguous stays `ENUM_UNPARSED`). **Synonym-table only:** not offered to prompt A, whose text and recorded cassettes stay unchanged until they can be re-recorded live — an unlisted header never maps to it | `TIME`, `Disposition`, `Rationalisation`, `TIME category` |
| `aiAutonomy` | `System.aiAutonomy` (how an AI agent acts: suggests / acts with approval / acts alone; blank means not an agent; read by the generic schema-attribute path) | `AI agent: how it acts` |
| `aiUse` | `System.aiUse` (built-in AI features / uses an AI model or service; read by the generic schema-attribute path) | `Uses AI` |
| `technology` | `Container.technology` | `Technology`, `Platform`, `Stack` |
| `parent` | container parent (system name) | `Parent system`, `Part of`, `System`, `Application` (on a Modules sheet) |
| `owner` | Actor candidate (`team` unless the value looks like a person) + `owns` (`role: 'business'`) | `Owner`, `Business owner`, `Service owner`, `Accountable`, `Team` |
| `ownerEmail` | `Actor.email` (person) | `Owner email`, `Contact` |
| `technicalOwner` | Actor candidate (`team` unless the value looks like a person) + `owns` (`role: 'technical'`, Prompt 7k item 2 — parallel to `owner`, never the same header) | `Technical owner`, `IT owner`, `Engineering contact`, `Support team` |
| `capability` | `supports` proposal via §6.3 | `Business area`, `Service`, `Function`, `Capability`, `Directorate`, `Domain` |
| `usesSystems` | `uses` proposals (multi-value) | `Depends on`, `Integrations`, `Interfaces with`, `Upstream` |
| `flowsTo` | `flows_to` proposals (multi-value) | `Sends data to`, `Feeds`, `Downstream` |
| `integrationPlatform` | `via` on the row's own `usesSystems`/`flowsTo` proposals (Prompt 7k item 4 — a name resolved against candidates of `kind: 'integration_platform'` first, then main, same two-pass resolution `parent`/endpoint text already gets, §7.4) | `Via`, `Integration platform`, `Routed through`, `Middleware` |
| `notes` | ignored, but shown in the passage | `Notes`, `Comments` |
| `ignore` | ignored | anything the mapping says to ignore |

A synonym hit maps with confidence 1.0. Headers with no synonym hit go to **prompt A (§6.1)** — one call per sheet, with the unmapped headers, five sample rows, and the role list. The model returns a role per header with its own 0–1 confidence and a one-line reason; the pipeline clips LLM mapping confidence to ≤ 0.90 and records `LOW_MAPPING_CONFIDENCE` on every candidate from a column mapped below 0.70. A column mapped by the model to `name` overrides nothing: if the synonym table already found a `name` column, a second `name` becomes `ignore` with a note. A sheet with no `name` column after both passes is skipped (`SHEET_NO_NAME_COLUMN`).

**Amended, Sprint F2b (folding in F2-lite's own two deterministic conventions):**
- An `owner`/`technicalOwner` cell of the form `"Name (External: Org)"` (case-insensitive on the literal word "External") produces an actor candidate with `subtype: 'organisation'`, `isExternal: true`, `externalOrganisation: Org` instead of the ordinary team/person inference — resolved by the same regex F2-lite's `parseOwnerCell` used, ported rather than re-derived. A plain name with no parenthetical is unaffected.
- A `capability` cell containing `|` is a literal, `|`-delimited list of capability names — the same convention as F2-lite's own `capability` column, kept because an explicit list is a stronger signal than free text needing inference. Each segment is resolved independently by name/alias match against the organisation's capability tree (§7, not §6.3 — prompt C is skipped for these rows: there is nothing left for the model to infer), deduplicated case-insensitively (a repeated name in one cell would otherwise propose the same `supports` edge twice, which C9/V6 rejects at fold time); an unresolved segment is dropped, never sent to prompt C and never a guess. **K-13's own primary/secondary rule is unaffected, not widened**: `eligibleForPrimary` is still "this row proposes exactly one capability edge" (`capabilityAssignment.ts`'s own tested behaviour — a prompt-C row naming two capabilities is already all-secondary today, deliberately; a `|`-delimited row resolving to two or more is treated identically, all-secondary, for the same reason). Only a pipe cell that resolves to exactly one live target (after dedup, or because every other segment failed to resolve) is primary-eligible. A cell with no `|` is unchanged: single value, resolved via §7 first and prompt C (§6.3) when that misses or is ambiguous.

The sheet's *element type* is decided once per sheet, with one row-level exception: `system` by default; `container` when a `parent` column resolves to systems (the sheet's `parent` values match systems on main or on another sheet's candidates) or the sheet is named like `Modules`/`Components`/`Containers`/`Services`; `capability` when the sheet is named like `Capabilities`/`Capability map` and has a level/parent structure; `actor` when the sheet is named like `Teams`/`Owners`/`Contacts`. The model is asked to confirm the sheet type in prompt A's response (`sheetType`) and its answer is used only when the code heuristics are undecided. **Amended, Sprint F2b:** when a sheet has a mapped `parent` column but is *not* named like a container-only sheet, the type is decided **per row** instead — a row with a blank `parent` cell is a `system`, a row with `parent` set is a `container` — the mixed-sheet shape F2-lite's own `platform` column supported (one register listing top-level systems and their modules together). A sheet that *is* named like a container-only sheet keeps the old per-sheet behaviour unchanged (every row a container, `parent` always required).

**Step 3 — rows to candidates (code).** For each data row (stopping at the first fully blank run of 3 rows or a row whose `name` cell is `Total`/`Totals`/`Count`):

```
candidate = ElementProposal(type = sheetType, name = trim(row[name]))
for role in mapped columns:
  raw = row[col]; skip if blank
  switch role:
    description, vendor, technology, externalOrganisation, hostingProvider, orgUnit: attributes[role] = collapseWhitespace(raw)
    lifecycleStatus: parseLifecycle(raw)   // §5.4; ENUM_FUZZY warning when not exact
    hostingModel: parseEnumFuzzy(raw, HOSTING_MODEL_VALUES)  // same ENUM_FUZZY shape as lifecycleStatus
    introduced, plannedEnd: parseDate(raw)  // §5.4; AMBIGUOUS_DATE when dd/mm vs mm/dd undecidable
    isExternal: parseBool(raw)              // yes/true/external/saas/hosted → true; no/false/internal/on-prem → false
    sourceKey: aliasProposals += {type: source_system_key, value: raw}
    atlasId: candidate.atlasId = raw        // consumed by §7.3 level 1
    parent: candidate.parent = {kind:'unresolved', text: raw}  // resolved in §7 against candidates first, then main
    owner: actorCandidate(raw) + RelationshipProposal(owns, from: actor, to: this, {role: 'business'})
    ownerEmail: attach to the actor candidate; subtype = person
    technicalOwner: actorCandidate(raw) + RelationshipProposal(owns, from: actor, to: this, {role: 'technical'})
    capability: deferred to §6.3 (batched)
    usesSystems, flowsTo: split on ; , / newline → one RelationshipProposal per value, endpoint {kind:'unresolved', text}
    integrationPlatform: attach {kind:'unresolved', text: raw} as `via` on every RelationshipProposal this row's usesSystems/flowsTo columns produced — resolved the same pass as their own endpoints (§7.4), against candidates of kind integration_platform first, then main
passage = header cells + row cells joined ' | '
sourceRef = sheet:{name}!{A}{row}:{lastCol}{row}; attributeRefs[role] = sheet:{name}!{col}{row}
```

A `MULTI_VALUE_CELL` in `vendor` ("Civica / Northgate") keeps the first value as the attribute, warns, and shows the whole cell in the passage — capture does not invent a second system from a vendor cell.

**Intra-document duplicates.** Before matching against main, candidates within one run are grouped by normalised `(type, name, parent)`; a group of ≥ 2 is collapsed to one candidate whose evidence lists every row (`attributeRefs` per row) and whose attributes are the union where rows agree and the *first* row's value with an `ENUM_FUZZY`-style warning `ROWS_DISAGREE` where they don't. The collapsed candidate's `passage` shows all rows. This is what turns three spellings of `PowerON` in one register into one proposal with three aliases (§7.6), not three `new` candidates.

### 5.2a Relationships sheet (Sprint F2b)

Folded in from F2-lite, which built this as its own dedicated mechanism rather than the inline `usesSystems`/`flowsTo`/`integrationPlatform` columns above — both coexist: an element sheet's own inline columns still work exactly as §5.2 describes, and a workbook may additionally carry one sheet whose rows *are* relationships directly.

**Detection.** A sheet is a Relationships sheet when its name matches `/relationships?|integrations?/i`, or (failing that) when its header row is a close match to `from, type, to, description, via, data_classification` (at minimum `from`/`type`/`to` present, unambiguously — a sheet this shape is never mistaken for an element sheet, since no element-sheet role maps a `type` header to anything). A workbook may have at most one Relationships sheet; a second one is `SHEET_NO_NAME_COLUMN`-style skipped with a warning, not merged into the first.

**Row → candidate (code, no LLM — this was always deterministic in F2-lite and stays that way):**

```
type = row[type]                          // 'uses' | 'flows_to' only; anything else → invalid, ILLEGAL_RELATIONSHIP-style
candidate = RelationshipProposal(
  relationshipType: type,
  from: {kind:'unresolved', text: row[from]},
  to: {kind:'unresolved', text: row[to]},
  attributes: { description: row[description], ...(type === 'flows_to' ? {dataClassification: row[data_classification]} : {}) }
)
via: {kind:'unresolved', text: row[via]} when set — resolved the same two-pass way §5.2's inline via already is (§7.4)
passage = header cells + row cells joined ' | '; sourceRef = sheet:{name}!{A}{row}:{lastCol}{row}
```

`description` is `required: true` at the UI-form level for both types (`relationshipAttributeSchema.ts`'s own `USES_META`/`FLOWS_TO_META`) — that requiredness is enforced on the manual "add relationship" dialog, never as an engine invariant (`RelationshipProposal.attributes` is typed `Partial`-free per relationship type, but nothing in `src/engine` refuses a create with `description` absent). A Relationships-sheet row with a blank `description` therefore isn't classified `invalid` (there is no existing "invalid because a required attribute is missing" path for a relationship candidate, unlike an element's own `PARENT_UNRESOLVED`) — it produces **no candidate at all**, the same silent-skip an entirely blank row gets elsewhere in this pipeline (rule 7's "never guess" extended to "never invent a verb phrase either"). `data_classification` on a `uses` row is dropped (the attribute doesn't exist on `UsesAttributes`), the same "wrong shape for this type" stance §5.4's value normalisation already takes elsewhere. `from`/`to` resolve against candidates from every sheet in this run first, then main (§7.4) — a Relationships-sheet row can reference an element the same workbook's own element sheet just proposed.

**Amended 2026-10-08 — importing this product's own export (round trip).** The `.xlsx` export (`src/ui/elements/elementExport.ts`) writes one sheet per element type plus a `Relationships` sheet with the columns `From, Type, To, Verb, Role`, and a re-import of it lost nearly everything: all 126 relationship rows of a real export were dropped (the importer read a `description` column the export calls `Verb`, and never read `supports`), every module came back with no platform (the Containers sheet had no parent column), the Actors sheet was read as systems, and similarly named capabilities were merged. Decided with the human; the importer and the export now agree:

- **Columns.** `Verb` is read as `description` when there is no `description` column. `Role` is the `role` of a `supports` row.
- **`supports` rows are read** — `from` a system or module, `to` a capability — with `role: 'primary' | 'secondary'`; a blank role defaults to `secondary` (K-13, the same default `capabilityAssignment.ts` uses) at defaulted-attribute confidence, and any other role is skipped. `owns` rows are **not** read: the owner comes from an element sheet's `Owner` column, and reading both would propose the same `owns` edge twice.
- **A blank verb on `uses`/`flows_to` still produces no candidate**, as above — never inventing a verb phrase stands. What changed is that no skip is *unseen*: every row left out is counted in the job's `stats` as `relationships.skipped.<MISSING_ENDPOINT | UNSUPPORTED_TYPE | MISSING_DESCRIPTION | INVALID_ROLE>`. Those counts are not shown in the UI yet; surfacing a skipped row to the reviewer would need a new `EvidenceWarning` code and is left as a follow-up decision.
- **Endpoint names.** An endpoint is the element's name, or — when two elements share a name, as two platforms each having a module `PM` do — `Platform · Module`. Resolution (§7.4) accepts both forms against this run's candidates and against main, and refuses a bare name that two different elements answer to (the row is `invalid`, `ENDPOINT_UNRESOLVED`) rather than linking whichever came first.

**Amended 2026-10-08 — the rest of the round trip (§5.2).** `Atlas ID` (the `atlasId` role) is the last column of every exported sheet, so a re-import into the same model matches exactly, and two rows with *different* Atlas IDs are never merged by §5.2's intra-document fuzzy pass however alike their names. A `Parent system` (module sheet) / `Parent capability` (capability sheet) / `Parent` column is read as the `parent` role; a capability sheet's parent is honoured (it was ignored — only module and mixed system sheets used it), and parents resolve before their children whatever the row order, because a sheet sorted by name lists a child first (`orderByParentDependency`, `runCapture.ts`). A sheet named like `Actors` is an actor sheet (alongside `Teams`/`Owners`/`Contacts`). The export writes an actor's person/team column as `Actor type` and a system's `Domain` (it/ot/hybrid) as `IT/OT domain`, because §5.2's synonym table reads a `Domain` header as a business area — a capability list — and would send `it` to capability matching. Every other column the export writes is a deterministic synonym too (`Kind`, `Criticality`, `IT/OT domain`, `Version`, `Run cost`, `Vendor support ends`, `Org unit`, `Reference`, `Importance`, `Essential function (NIS/CAF)`, `Actor type`, the `(module override)` columns, `Introduced`, `Planned end`, `External organisation`, `Email`), so reading the export back never asks prompt A. The schema-backed ones (`kind`, `criticality`, `domain`, `version`, `annualRunCost`, `code`, `importance`, `essentialFunction`) are validated against the element type's `attributeFieldSchema` (`validateAttributeValue`): an enum cell is read by key, spaced key or label; an unparseable cell is dropped with `ENUM_UNPARSED`, and a type that lacks the attribute ignores the column silently. `Actor type` sets an actor's subtype (person/team/organisation) and `Email` on an actor row is the actor's own email. The same actor named on several sheets (Actors sheet and an Owner cell) merges to one (`mergeSameNamedActors`), and when two rows of one element disagree a *stated* value beats a *defaulted* one (confidence ≤ 0.6, §5.4) rather than raising `ROWS_DISAGREE`. Proven end to end by `src/capture/exportImportRoundTrip.integration.test.ts` (real Supabase: export model A to `.xlsx` with the real loaders, import into empty model B through the real gates, compare elements, attributes and relationships exactly; re-importing A's export into A is a no-op), with a model stub that throws if called. Not yet round-tripped: `owns` rows (the `Owner` column returns only the first owner, as a business owner — technical/service owners are lost), a capability's `Order`, and `uses`/`flows_to` rows with a blank verb (§5.2a: never invent a verb). Relationship rows skipped for a missing endpoint, unsupported type or invalid role are counted in job stats (`relationships.skipped.<reason>`) but not yet shown in review.

**Amended 2026-11-19 — module vendor support end (JSON/spreadsheet import).** A module row may set `support_ends_at` (Simon, 2026-11-19): a module carries its own vendor support end in the model, never inherited from its platform, so the importer no longer rejects it. Nothing else about the importer changed.

**Amended 2026-10-15 — flows through an integration platform (§5.2a, §7.4).** The export's `Relationships` sheet gained two columns, `Via` (the integration platform a `uses`/`flows_to` flow goes through, named like an endpoint — "Parent · Name" when the name is shared) and `Data classification` (a `flows_to` edge's own). Before this a re-import could not tell a flow routed through a platform from a direct one: the export dropped `via`, so the platform survived as a system row but nothing linked to it. The sheet reader takes `Via` as `viaHint` and reads `Data classification` by key, spaced key or label like any enum cell; one it cannot read is dropped with `ENUM_UNPARSED`, never guessed. A `via` that resolves to nothing — no such system, or one whose kind is not `integration_platform` — is still dropped rather than invalidating the flow (`via` is optional), but is now reported as `ENDPOINT_UNRESOLVED` with `end: 'via'` (the code's own type already named that end), so the review shows the flow came in as direct instead of losing the platform silently. A related promotion bug found by the real-database round trip: `buildPromotionEnvelope` re-pointed an edge's `from`/`to` onto freshly minted element ids but copied `attributes.via` as the draft id, so any import that created a platform and a flow through it in the same run wrote an edge whose `via` named an element that did not exist (C18 rejected it on fold); `via` is now remapped the same way as an endpoint. Proven by `exportImportRoundTrip.integration.test.ts` (a platform, a `flows_to` with `via` and `dataClassification`, a `uses` with `via`).

### 5.3 PDF and pasted text

**Chunking.** PDF: consecutive pages are grouped into chunks of ≤ 12,000 characters, never splitting a page. Text: one chunk if ≤ 12,000 chars, else split at paragraph boundaries. Each chunk carries its page numbers and absolute char offsets so a returned `passage` can be located.

**Extraction — prompt B (§6.2)**, one call per chunk, streamed. The model returns candidates *in the taxonomy*: element type, name, parent name (text), attributes, and for each fact the verbatim `passage` it rests on and its confidence. Relationship proposals name endpoints as text.

**Grounding (code).** For every returned fact, `passage` must occur in the chunk text: byte-exact → grounding factor 1.0; after normalising whitespace, quotes and dashes → 0.85 with `PASSAGE_NORMALISED`; not found → the fact is dropped from the proposal and, if it was the `name`, the whole candidate becomes `unsourced` with the model's text kept in `evidence.passage` for the reviewer. `sourceRef` is computed from where the passage was found, never from a page number the model states.

**Resolution.** Parent and endpoint texts are resolved exactly as sheet `unresolved` refs are (§7.4): first against candidates in this run (any chunk — a system named on page 3 and its module on page 9 resolve), then against main.

### 5.4 Value normalisation and the two defaults

| Attribute | Parsing |
|---|---|
| `lifecycleStatus` | exact enum value → 1.0. Fuzzy table (`ENUM_FUZZY`, factor 0.95): `live`, `in service`, `production`, `operational`, `current` → `active`; `pipeline`, `planned`, `proposed`, `in procurement`, `future` → `planned`; `sunset`, `decommissioning`, `end of life`, `being replaced`, `legacy` → `retiring`; `decommissioned`, `retired`, `closed`, `switched off`, `gone` → `retired`. Anything else → attribute omitted, warning `ENUM_UNPARSED` with the raw value in the passage. |
| dates | ISO, `dd/mm/yyyy` (UK default), `mm/dd/yyyy` only when day > 12 forces it, `Mon yyyy`/`yyyy-Qn` → first day of the month/quarter with `AMBIGUOUS_DATE` (factor 0.8), a bare year → `yyyy-01-01` with `AMBIGUOUS_DATE`. |
| booleans | as in §5.2; anything else omitted. |
| names | trimmed, internal whitespace collapsed, trailing ` (legacy)`/` - old`/` v2`-style suffixes **kept** (they may be the real name) but the bare stem is added as an extra alias proposal of type `name`. |
| `email` | must match a permissive email regex, else omitted. |

**Required attributes the document rarely states.** `System.lifecycleStatus`, `System.isExternal`, `Container.isExternal`, `Actor.subtype` and `Actor.isExternal` are required by the contract. When the document doesn't assert them the candidate would be `invalid`, which would make most real registers unusable. Two defaults are therefore allowed, and only these two, each written as its own fact with confidence 0.60 and `attributeRefs[attr] = the row range` so the badge shows `●○○` and the provenance card says "defaulted by capture, not stated in the source":

- `lifecycleStatus = 'active'` for a system in a register with no status column (a register lists what exists).
- `isExternal = false` for system/container/actor with no external indicator; `subtype = 'team'` for an actor unless the value contains an email or looks like `Firstname Surname`.

No other attribute is ever defaulted. This is not a demo shortcut (rule 7): the fact is real, sourced to the row, and honestly low-confidence.

**Amended, a third default for prose-extracted relationship `role` (found in a capture-pipeline audit, issue #283):** `SupportsAttributes.role`/`OwnsAttributes.role` (`src/contracts/delta.ts`) are required, non-optional contract fields — unlike an element's own attributes (always `Partial<>`), a `supports`/`owns` relationship candidate cannot form a legal delta at all without one. Sheet rows always have a source for it (K-13: the matched header, or the row's own single/first capability edge); prose extraction (§6.2's prompt B) has no equivalent structural signal — the model is never asked for a role at all, since role is an inference from context (which header matched, which edge is primary), not something a sentence states. `src/capture/extractProse.ts`'s `applyRoleDefault()` therefore defaults an unset `supports.role` to `secondary` and an unset `owns.role` to `business`, both at the same 0.60 confidence as §5.4's other two defaults, with `attributeRefs` pointing at the passage that grounded the rest of the relationship. Kept, not narrowed to `invalid`, on the same reasoning as the two defaults above: a real, sourced, honestly-low-confidence fact beats forcing every prose-derived relationship through manual review just to supply a role the document was never going to state.

### 5.5 Confidence

All machine-extracted confidence is capped at **0.95** for sheets and **0.90** for prose; **1.0 is reserved for human assertion** (UI §4.3).

```
sheetAttrConf(col, cell) = min(0.95, mappingConf(col) × parseFactor(cell) × rowFactor(row))
  mappingConf: 1.0 synonym; LLM's value clipped to [0, 0.90]
  parseFactor: 1.0 exact; 0.95 ENUM_FUZZY; 0.8 AMBIGUOUS_DATE; 0.9 MULTI_VALUE_CELL / ROWS_DISAGREE
  rowFactor: 0.95 if the row touches a merged range or has a formula error, else 1.0

proseAttrConf(fact) = min(0.90, modelConf(fact) × groundingFactor(fact))
  groundingFactor: 1.0 exact; 0.85 PASSAGE_NORMALISED

existenceConf(candidate) = min over {name, required attributes present} of attrConf
candidateConf = existenceConf                          // written on create deltas, and on capture_candidates.confidence
updateConf(attr) = min(attrConf(attr), matchConf)       // §7.5
defaulted attribute = 0.60 (§5.4); gone = 0.50 (K-14)
```

**Amended, Sprint F2b (bug found authoring fixture 12, §12.2):** `existenceConf`'s "min over {name, required attributes present}" assumes every element candidate asserts its own name and every attribute `REQUIRED_ATTRIBUTES_BY_TYPE` lists for its type — true for `new`/ordinary `update` (§5.4's own defaulting guarantees a confidence for every required attribute even when the document is silent), but never true for a `changes`-section retire/restore (§5.6): that candidate deliberately asserts `lifecycleStatus` only, never re-describing the element it targets. Applying the general rule unmodified floored every retire/restore candidate's own `candidateConf` at 0 regardless of its real `lifecycleStatus` confidence — not a data-correctness bug (`buildCaptureDraftEnvelope.ts` reads each attribute's own confidence from `evidence.attributeConfidence` directly, never `candidateConf`, so the promoted delta was never wrong), but a real display/sort defect: every retire/restore would have shown 0% confidence in the review queue. Fixed at the source: a candidate with `mustMatchExisting` set computes `candidateConf` as `existenceConf` over whatever attributes it actually populated (the same "no fixed required list" shape relationship candidates already use), not the name/required-attributes floor.

### 5.6 JSON (Sprint F2b)

A fourth input, folded in from F2-lite: `{ systems: [...], relationships: [...], changes: [...] }` — pre-parsed structure a person or an external AI assistant (`docs/import/PROMPT.md`) already extracted, handed to Atlas directly rather than as prose or a spreadsheet for capture's own extraction to work on. `RunCaptureSource.format` gains `'json'`; `CaptureJob.inputKind` stays `'spreadsheet'` — structurally this is the same systems/relationships shape §5.2 already produces candidates for, just pre-extracted, and it shares that section's matching, classification and review-queue treatment entirely. No column mapping and no prompt A: there are no columns, the file already names its fields.

**Sections.** `systems` — one entry per element (`name` plus the same core attributes §5.2's row shape covers: `description`, `kind`, `lifecycle`, `criticality`, `domain`, `hosting_model`, `vendor`, `is_external`, `external_organisation`, `platform`, `capability` — same owner-external-syntax and `|`-delimited capability list as §5.2's amendment). `relationships` — one entry per `uses`/`flows_to` edge, same shape as §5.2a's Relationships-sheet row. Both produce ordinary `ElementProposal`/`RelationshipProposal` candidates, matched and classified exactly as any other input (`new`/`update`/`confirm`/`conflict`/`ambiguous`/`gone`/`invalid`/`unsourced`/`duplicate_in_target` — no new class for either section).

**`changes`** — F2-lite's own third section, with no equivalent elsewhere in this document: an explicit, named instruction (`{name, action: 'retire'|'restore', reason?, replaced_by?}`), not something extracted from a row's own attributes. `name` must resolve to an *existing* element via ordinary matching (§7) — an unresolved name is `invalid` (`PARENT_UNRESOLVED`-style: the entry names something nowhere in the model), never a silent no-op and never a `new` candidate (a `changes` entry never creates anything). A resolved entry becomes an ordinary `ElementProposal` carrying only `attributes: { lifecycleStatus: action === 'retire' ? 'retired' : 'active' }` against the matched element, classified `update` or `conflict` exactly as any other attribute change (§4.4) — not a new class; the only thing distinguishing it from an ordinary sheet-driven update is that its match is mandatory rather than the usual "no match → new". `restore` rejects a `replaced_by` (validated at parse time, mirroring F2-lite's own `validateImportChangeRow`).

`replaced_by` (retire only) is proposed as its own ordinary `replaces` relationship candidate (ADR-001 amendment) — `{replacement} replaces {retiring element}` — rather than a field on the retiring element's own candidate: `resolveEndpointRef` (§7.4) already refuses to resolve either end to anything but an existing element (never mints one), which is "replaced_by never creates anything" for free, and no `CaptureCandidate` schema change is needed. On promotion (§8.2), a `replaces` candidate being promoted `new` triggers the retiring element's own live `supports` edges to transfer to the replacement — retract the old edge, create a new one from the replacement at `role: 'secondary'` (never `'primary'` — promoting one could collide with a primary the replacement already has elsewhere), carrying over `description` if any — the same shape and reasoning `useElementRetire.ts`'s own "replaced by" picker already uses elsewhere in the product; `from`/`to` are immutable on a relationship, so this is retract-and-recreate, never a `relationship.update`. `reason` is free text, carried to the review queue for context, never affecting any delta.

**Evidence and confidence.** Every JSON entry may carry `quote` (a supporting passage from whatever the file's author was working from) and `confidence` (0–1), both optional, both per-entry across all three sections. `evidence.extractor = 'json-authored'`; `evidence.passage = quote` verbatim when given, else the entry's own JSON fragment rendered as text — there is no raw source document to verify a `quote` against, so §5.3's grounding check does not apply to this extractor (a `json-authored` fact is never `unsourced` on grounding grounds; the reviewer sees exactly what the file said, unverified against anything). **Confidence: an entry with no stated `confidence` is capped at 0.90, the same ceiling §5.5 gives prose** — decided with the human rather than kept at F2-lite's own hardcoded 1.0: K-5/ADR-007 reserve 1.0 for a real human assertion made in the review queue's own edit panel, and uploading a file — often drafted by an external AI per `docs/import/PROMPT.md` — isn't that, even though a human chose to upload it. A stated `confidence` is used as given (clipped to [0, 1] at parse time), on the same reasoning §5.5's other authored-confidence paths already apply.

**MuleSoft Anypoint source (import plan, steps 1–3).** The upload dialog's *What are you importing?* cards (one entry per source in `src/capture/importSources.ts`: documents and notes, then a card per tool export) convert a MuleSoft export in the browser (`src/capture/adapters/mulesoft.ts`, `mulesoftUpload.ts`) into this section's `{ systems, relationships, changes }` JSON before the run starts, so the run is an ordinary JSON run (`inputKind: 'spreadsheet'`, `format: 'json'`) and nothing in `capture-run` changes. The converted JSON — not the raw export — is what the job stores, re-imports against and cites in `source_ref`. The export itself is made by `docs/import/mulesoft/mulesoft-export.mjs`, run by the user. Producers are never inferred from a hostname: only a user-supplied hostname → element mapping makes a `flows_to … via` interface; otherwise a `uses` to the interface. Known limitation: §5.2's intra-document duplicate check merges near-identical interface names, which the conversion report warns about and the reviewer splits. User guide: `docs/import/mulesoft/README.md`.

---

## 6. LLM prompts

Three prompts. Each is a frozen string in `src/capture/prompts/{a,b,c}.ts` with its JSON schema beside it; the request is built with the stable system block first (cache-controlled), volatile content last. Every prompt tells the model the taxonomy, the closed vocabularies, and that it may never invent evidence. Structured outputs (`output_config.format`, strict schema) replace any instruction to "reply in JSON"; there is no assistant prefill.

Effort: prompt A `medium`, prompt B `medium`, prompt C `medium`. `max_tokens: 16000`. Model: `claude-opus-5` unless `CAPTURE_MODEL` says otherwise. `stop_reason` handling is in §11.

**Amended, prompt B effort (found in a capture-pipeline audit, issue #282):** this section originally set prompt B to `high`. Built at `medium` instead (`src/capture/extractProse.ts`'s own `PROMPT_B_EFFORT`) — `high` effort with the model's default-effort thinking can take a single extraction call up to ~150s, and a multi-chunk document needs several calls per invocation; K-12's own `capture-run` step is bounded to ≤ 60s wall clock. `medium` was the disclosed tradeoff never carried back into this document until now. Revisit once chunk-level resumability (K-12's own deferred row) means one invocation no longer has to fit a whole chunk's extraction inside one bounded step.

### 6.1 Prompt A — spreadsheet column mapping

**System**

```
You map spreadsheet columns to a fixed set of roles for an enterprise-architecture model.

The model has four element types: capability, system, container, actor. A spreadsheet
sheet usually lists one type. The column roles you may assign are exactly:

  atlasId, sourceKey, name, description, vendor, lifecycleStatus, introduced, plannedEnd,
  isExternal, externalOrganisation, hostingModel, hostingProvider, technology, parent, owner,
  ownerEmail, technicalOwner, capability, usesSystems, flowsTo, integrationPlatform, notes, ignore

Role meanings:
- atlasId: a UUID column written by this product's own export.
- sourceKey: the source system's own stable identifier for the row (asset id, CMDB id, reference).
- name: the element's name. Exactly one column per sheet.
- description: free text describing the element.
- vendor: supplier or product vendor of a system.
- lifecycleStatus: live/planned/retiring/retired style status.
- introduced: date the system went live or was implemented.
- plannedEnd: planned decommission, contract end, or end-of-life date.
- isExternal: whether the system is operated outside the organisation (SaaS, hosted, third party).
- externalOrganisation: who operates it, when external.
- hostingModel: on-premises, private cloud, public cloud, SaaS, or hybrid — a closed set, not free text.
- hostingProvider: the specific hosting provider, data centre or region, when named. Free text, distinct from hostingModel.
- technology: platform or stack of a container.
- parent: the system this container row belongs to.
- owner: the team or person accountable for the row (its business owner).
- ownerEmail: the owner's email.
- technicalOwner: the team or person who runs the row day to day, when distinct from owner.
- capability: a business area, service, function or capability the system supports.
- usesSystems: other systems this one depends on.
- flowsTo: systems this one sends data to.
- integrationPlatform: the integration platform (ESB, API gateway, message bus) a usesSystems/flowsTo relationship in this row actually goes via, when named.
- notes: commentary to show a reviewer but not to extract.
- ignore: anything else (costs, risk scores, maturity ratings, project names, process steps —
  these are deliberately outside the model).

Rules:
- Assign each header exactly one role. Prefer ignore over a doubtful mapping.
- Your confidence is a number in [0, 1] meaning how sure you are of the role, from the header
  text and the sample values together.
- Never assign name to more than one column; if two columns could be the name, give the second
  one sourceKey or description with a reason.
- sheetType is your best reading of what one row of this sheet is: system, container,
  capability, actor, or unknown.
```

**User** (volatile; one per sheet)

```
Workbook: {input_name}
Sheet: {sheet_name} ({row_count} data rows)

Headers already mapped by a synonym table (do not remap these):
{mapped_header → role, one per line}

Headers to map:
{unmapped headers, one per line, as "column {A1 letter}: {header text}"}

Sample rows (values for the unmapped columns only, '|' separated, blank kept as empty):
{up to 5 rows}
```

**Schema** (`strict`): `{ sheetType: enum, columns: [{ column: string, role: enum, confidence: number, reason: string }] }`, `additionalProperties: false`, every field required.

### 6.2 Prompt B — extraction from prose (PDF and pasted text)

**System**

```
You extract enterprise-architecture facts from documents into a fixed taxonomy. You are a
careful clerk, not an analyst: record what the text says, quote where it says it, and leave out
what it does not say.

Element types (with the attributes you may fill):
- capability: name, description, parentName
- system: name, description, vendor, lifecycleStatus (planned|active|retiring|retired),
  isExternal (true|false), externalOrganisation, introduced (date), plannedEnd (date)
- container: name, description, technology, parentName (the system it is part of), isExternal
- actor: name, subtype (person|team), email, orgUnit, isExternal, externalOrganisation

Relationship types (from → to):
- supports: system → capability. "The X system supports the Y function / service / area."
- uses: system|container → system|container. A runtime dependency.
- owns: actor → capability|system. Accountability: "owned by", "the X team are responsible for".
- flows_to: system|container → system|container. Data or integration flow: "sends", "feeds",
  "exports to".

Not in the taxonomy — never emit these as elements: business processes and workflow steps,
data entities, infrastructure (servers, networks, racks), projects and programmes, goals and
KPIs, requirements, costs and budgets, risks, service-catalogue entries, maturity scores,
reporting lines. A project that introduces a system is evidence about the system, not an element.

Evidence rules — these are strict:
- Every fact (each element, each attribute value, each relationship) carries a passage: the
  exact text from the document it rests on, copied verbatim, at most 300 characters, without
  ellipses or paraphrase. The pipeline verifies each passage against the document and discards
  any fact whose passage is not found.
- One passage may support several facts. Do not stretch a passage to cover a fact it doesn't
  state.
- confidence is a number in [0, 1]: how clearly the passage states the fact. A vendor named in a
  table row is ~0.9; a status inferred from "we are moving away from" is ~0.6; a guess is < 0.4
  and you should usually omit it instead.
- Use the document's own names for elements. Do not normalise, expand acronyms, or merge two
  differently named things — matching is done later, by code, against the organisation's model.
- Dates: copy the document's wording into passage and give the date as ISO (YYYY-MM-DD) in the
  value; a bare year is YYYY-01-01.
- If the chunk contains nothing in the taxonomy, return empty lists.
```

**User** (one per chunk)

```
Document: {input_name}
{ "Pages {first}–{last} of {total}." | "Pasted text, characters {start}–{end} of {total}." }
{ "Elements already found in earlier chunks of this document (names only, for parentName and
   relationship endpoints — you may refer to them, do not re-emit them unless this chunk adds
   attributes): {names}" }

--- BEGIN TEXT ---
{chunk text}
--- END TEXT ---
```

**Schema** (`strict`):

```
{
  elements: [{
    elementType: enum, name: string, namePassage: string, nameConfidence: number,
    parentName: string | null,
    attributes: [{ key: string, value: string | boolean, passage: string, confidence: number }]
  }],
  relationships: [{
    relationshipType: enum, fromName: string, toName: string,
    passage: string, confidence: number,
    attributes: [{ key: string, value: string | boolean, passage: string, confidence: number }]
  }]
}
```

`attributes[].key` is validated by code against the type's contract keys; an unknown key is dropped with a warning, never stored.

### 6.3 Prompt C — capability assignment (closed vocabulary)

Used only when a sheet has a `capability` column (or prose yields `supports` with a capability name), and only when §7's alias/name+context match against the model's capabilities fails or is ambiguous. The model chooses from the organisation's *own* capability tree — it never invents a capability. This is "the pipeline's single most valuable inference" (prompt pack, Decisions from use: Capture) and it is constrained accordingly.

**System**

```
You assign rows from a system inventory to capabilities in an organisation's capability map.

You will be given the organisation's capability tree: each capability has a stable code, a name,
its parent, and a one-sentence definition. Choose from this tree only. If no capability fits,
answer none — do not propose a new capability.

For each row you are given the system's name, the text from its business-area / service /
function column, and its description if any. Choose the single most specific capability that the
system directly supports. Prefer a level-2 capability to its level-1 parent when the row's text
makes the level-2 clear; choose the level-1 when it doesn't. If the row's text names two
capabilities, return both, most specific first.

confidence is in [0, 1]: 0.9+ when the row's text is a near-restatement of the capability's name
or definition; ~0.7 when the mapping is a reasonable reading; below 0.5, answer none instead.
```

**User** (one per batch of ≤ 50 rows; the tree is the stable, cache-controlled part of the system block in practice — it goes in `system[1]` with `cache_control`, and the batch goes here)

```
Rows:
{ seq | system name | capability-column text | description (truncated to 200 chars) }
```

**Schema** (`strict`): `{ assignments: [{ seq: number, capabilities: [{ code: string, confidence: number }] }] }`. A returned `code` not in the tree is dropped with a warning `CAPABILITY_CODE_UNKNOWN`.

The tree given to the model is main's capability elements (name, computed level, parent, `description`), keyed by a per-run code derived from the element id — never the starter map's own template code (ADR-020: the template vocabulary is reachable through `template_code` aliases, which §7's level 2 already matches; the model sees the organisation's tailored names).

Resulting `supports` proposals carry `attributes.role` per K-13 and confidence `min(0.90, model confidence)`.

### 6.4 Prompt hygiene

- Prompts are versioned: `PROMPT_VERSION` in `src/capture/prompts/index.ts` is recorded in `capture_jobs.llm_usage.promptVersion` and in every fixture cassette's key. Changing a prompt invalidates the cassettes, which is the point — the live evaluation (§12.6) must be re-run and its scores re-committed.
- No timestamps, job ids or user names inside the system block (they would break the cache prefix and add nothing the model needs).
- The model never sees another organisation's data: the capability tree and the earlier-chunk names are the current model's only.
- Logging: request and response bodies are stored under `capture-inputs/{org}/{model}/{job}/llm/{n}.json` alongside the input, for audit and for building new fixtures from real runs (with the user's permission, per fixture).

---

## 7. Matching

Implements SPEC §8, order fixed, first hit wins. `src/capture/match.ts` is pure; `src/capture/matchIndex.ts` builds the in-memory index the pure code searches from one set of reads.

### 7.1 Inputs (one read set per run)

- `elements_head` at `main.head_commit_id` (all rows; `selectAll`).
- `aliases` for the model, all types including `merged_id` (`listAliasesForModel` today excludes `merged_id`; the worker's own read includes it).
- `relationships_head` at main's head (for S-6 duplicate checks and `confirm` on relationships).
- `facts` at main's head (for `previousDeltaId`, `conflict` strength, and `confirm` equality).
- Optionally the target change branch's folded head (`foldFromGenesis`), when the job already has a `target_branch_id` — a candidate that matches an element created *on that branch* resolves to it, so a two-document import into one change doesn't create the same system twice. **Amended, issue #285:** "resolves to it (as `existing`)" turned out to need its own class, not a plain `existing` match — the draft branch forks from main, which has no legal way to write a delta against an element main doesn't have yet, so a hit here is `duplicate_in_target` (§4.4), never an ordinary `update`/`confirm`. Built as a second, alias-free index (`buildTargetOnlyMatchIndex`, `matchIndex.ts`) over only the target branch's own elements that aren't on main yet, consulted only when the ordinary match against main misses.

Reads are scoped by commit id; nothing filters by a caller-supplied id list (rule 8, SPEC §6.7).

### 7.2 Normalisation

```
normaliseName(s):
  NFKC → lowercase → strip diacritics → replace '&' with 'and' → replace any run of non-alphanumerics with one space → trim
  → drop leading 'the '
```

The same function feeds alias lookup, trigram similarity and intra-document grouping. It is exported from `src/capture/normalise.ts` and is the *only* normaliser capture uses; `src/engine/merge.ts`'s `normalizeName` (trim + lowercase) stays as is — the merge classifier's identity check is deliberately exact.

### 7.3 Levels

```
match(candidate, index) -> MatchOutcome
  // 1. exact id
  if candidate.atlasId:
    id = candidate.atlasId
    if index.elements.has(id) and type matches: return {level:'exact_id', elementId:id, score:1}
    if index.mergedIdAlias.has(id): return {level:'exact_id', elementId: survivor(id), score:1, note:'resolved through merged_id'}
    warnings += ATLAS_ID_NOT_FOUND            // fall through: the id may be from another model or a deleted export
  // 2. alias
  for value in [candidate.sourceKeys..., normaliseName(candidate.name), normalised name stems]:
    hit = index.aliasByNormalisedValue.get(value)      // unique per (model, type, lower(value)) — SPEC §3.6
    if hit and index.elements.get(hit.elementId).type == candidate.type:
      return {level:'alias', elementId: hit.elementId, score:1, aliasType: hit.aliasType}
  // 3. name + type + context
  pool = index.elements where type == candidate.type
         and contextMatches(candidate, element)        // §7.4
  scored = pool.map(e => (e, trigram(normaliseName(candidate.name), normaliseName(e.name))))
  hits = scored.filter(s >= 0.60).sortBy(-score, e.name, e.id)
  similar = scored.filter(0.50 <= s < 0.60)
  if hits.empty: return {level:'none', similar}
  if hits.length >= 2 and hits[0].score - hits[1].score < 0.05:
    return {level:'name_context', elementId: hits[0].id, score: hits[0].score, ambiguous: hits.slice(0,5), similar}
  return {level:'name_context', elementId: hits[0].id, score: hits[0].score, similar}
```

`trigram` is the pg_trgm algorithm: pad each word with two leading and one trailing space, take all 3-grams, similarity = |A ∩ B| / |A ∪ B|. P-K2 checks it against `similarity()` in Postgres for 1,000 generated pairs.

### 7.4 Context

| Candidate type | Context that must match | How the candidate's context is resolved |
|---|---|---|
| system, actor | the type alone (SPEC §8) | — |
| container | same parent system | `parent` ref → candidate in this run (then the *candidate's* eventual id is the context, which for level 3 means: only containers whose parent is an element that candidate matched to) or main element |
| capability | same parent capability (or both top-level) | `parent` ref, or `none` |

An `unresolved` parent that resolves to nothing → the candidate is `invalid` (`PARENT_UNRESOLVED`) rather than matched without context. For a relationship endpoint, the same resolution applies; an unresolved endpoint makes the relationship candidate `invalid` (`ENDPOINT_UNRESOLVED`), never a silently created element (ADR-008 rule 4: never silently create).

### 7.5 Outcome and match confidence

```ts
export type MatchOutcome = {
  level: 'exact_id' | 'alias' | 'name_context' | 'none';
  elementId?: UUID;
  score: number;                     // 1 for levels 1–2; trigram for 3; 0 for none
  aliasType?: AliasType;
  ambiguous?: { elementId: UUID; name: string; score: number; parentName?: string }[];
  similar: { elementId: UUID; name: string; score: number; parentName?: string }[];   // 0.50–0.60, UI warning
  warnings: ('ATLAS_ID_NOT_FOUND' | 'RESOLVED_THROUGH_MERGED_ID')[];
};

matchConf = { exact_id: 0.95, alias: 0.95, name_context: 0.60 + 0.35 × (score − 0.60) / 0.40 }   // 0.60 → 0.60, 1.00 → 0.95
```

### 7.6 Aliases learned

Every level-2 or level-3 match, and every `merged` review decision, yields **alias proposals** stored on the candidate (`proposal.aliasProposals`) and written as real `aliases` rows by `atlas.apply_capture_decisions` when the candidate is accepted or merged:

| Situation | Alias written |
|---|---|
| level 3 match on name | `name` = the document's exact name string, if not already an alias |
| `sourceKey` column present, any level | `source_system_key` = the key |
| intra-document group (§5.2) | `name` for every variant spelling |
| reviewer `m` merges a `new` candidate into an existing element | `name` = the candidate's name, plus its source keys |

`source_id` = the run's source; `confidence` = the match confidence (or 1.0 for a reviewer's merge — it is a human assertion); `created_by` = the reviewer. Uniqueness (`aliases (model_id, alias_type, lower(alias_value))`) is respected by skipping an alias that already resolves to the same element and by raising `ALIAS_COLLISION` (§11) when it resolves to a *different* one — that is an identity conflict for the duplicates report (ADR-019), not something capture resolves on its own.

---

## 8. From a run to a branch, and from a review to a change

### 8.1 The draft branch (write stage)

The worker, service role, in one transaction (a single security-definer function `atlas.write_capture_draft(p_job_id, p_branch, p_envelope, p_candidates, p_stats)`):

1. Insert the `branches` row: `kind = 'capture_draft'`, `status = 'draft'`, `name = 'capture/{job_id}'`, `title = '{input_name} — {document_date | run date}'`, `base_commit_id = head_commit_id = main.head_commit_id` at that instant.
2. Insert one `commits` row, `kind = 'capture'`, `parent_commit_id = main.head_commit_id`, `title = 'Capture from {input_name}'`, `body` = a one-paragraph summary of `stats`, `author_id = job.created_by`.
3. Insert the deltas — every candidate's `draft_delta_ids` — with `source_id` = the run's source, `source_ref`, `effective_date = document_date`, `confidence` per §5.5/§7.5, `created_by = job.created_by`. Only C1–C6 are required on a `capture_draft` (S-14), and the worker has already folded the envelope with `src/engine` to check them (C6's `previousDeltaId` comes from main's `facts`); C9 and C17 are enforced inside `apply()` on every fold regardless, which is why §4.4 makes an illegal triple `invalid` and K-13 avoids a second primary before the envelope is built.
4. Advance `branches.head_commit_id` to the new commit.
5. Insert the `capture_candidates` rows.
6. `capture_jobs`: `resulting_branch_id`, `stats`, `status = 'parsed'`, `finished_at`, `progress = null`.

`stats` (jsonb) is the review queue's summary row and the job list's counts:

```json
{ "candidates": 412, "byClass": {"new": 38, "update": 120, "confirm": 231, "conflict": 9, "ambiguous": 4, "gone": 6, "invalid": 2, "unsourced": 2},
  "byKind": {"element": 300, "relationship": 112},
  "byMatchLevel": {"exact_id": 0, "alias": 190, "name_context": 152, "none": 70},
  "reimport": {"ofJobId": "…", "new": 38, "changed": 129, "unchanged": 231, "gone": 6},
  "sheets": [{"name": "Applications", "rows": 300, "type": "system", "skipped": false}],
  "warnings": {"LOW_MAPPING_CONFIDENCE": 300, "AMBIGUOUS_DATE": 12},
  "decided": {"accepted": 0, "rejected": 0, "merged": 0, "edited": 0, "split": 0} }
```

A draft is **never merge-eligible** (ADR-004): `atlas.submit_merge_request` already requires `kind = 'change'` and stays that way. It is visible to contributor+ of the org only (`branch_visible_to_viewer` is false for `capture_draft`).

**Main moves while a draft is open.** The draft's `base_commit_id` is fixed at run time. Promotion (§8.2) targets a *change* branch and re-derives `previousDeltaId` against that branch's current head at apply time, so a stale draft never blocks a review — but a candidate whose matched element has since been retracted on main becomes `invalid` at apply time (`TARGET_RETRACTED`, §11) and is returned to the reviewer rather than silently dropped.

### 8.2 Staging and applying decisions

**Staging** is `atlas.stage_capture_decisions(p_job_id, p_decisions jsonb)`: sets `decision`, `decision_detail`, `decided_by`, `decided_at` on the named candidates. Staged decisions survive a reload server-side (UI §5.2 keeps a local copy keyed by the draft head as well — both agree because the draft head never moves after write). `u` (undo) stages `decision = null`.

**Applying** is `atlas.apply_capture_decisions(p_job_id, p_target_branch_id, p_envelope, p_alias_rows, p_candidate_outcomes)` — security definer, contributor+ on the org, target must be a `change` branch in `draft` status the caller may commit to:

1. Calls `atlas.commit_deltas` with `p_envelope` (kind `manual`, one commit; `title` generated by `describeEnvelope` from the promoted deltas exactly like any manual commit — "Add system Tenant Portal, update 3 systems, link 2 supports" — with `body = 'From capture of {input_name} (job {id})'`). The client built the envelope with `src/engine` by folding the target branch's head and applying the promoted deltas (K-4 re-minting: `promoted_subject_id` per candidate is chosen client-side and passed in `p_candidate_outcomes`; the function checks each is unused, C5).
2. Inserts `p_alias_rows` (§7.6), skipping any that already resolve to the same element.
3. Updates `capture_candidates.promoted_commit_id`/`promoted_subject_id` for the applied candidates.
4. Inserts `resolved_conflicts` rows for `edited` candidates (winning = the human delta, discarded = the draft delta).
5. `capture_jobs.target_branch_id = p_target_branch_id`; `stats.decided` recomputed; if no candidate remains undecided, `status = 'reviewed'` and the draft branch `status = 'archived'`.

All in one transaction: a failure at any step leaves the target branch, the aliases and the candidates exactly as they were. Rejected candidates are never deleted — the draft commit still holds their deltas and the candidate row holds the decision (UI §5.2: "recorded, not deleted").

What each decision promotes:

| Decision | Promoted deltas |
|---|---|
| `accepted` on `new` | `element.create` with a fresh id, same attributes, same provenance; relationship candidates that reference it are re-pointed |
| `accepted` on `update`/`conflict`/`confirm` | `element.update` per attribute against the *target branch's* current fact (`previousDeltaId` re-derived), same provenance |
| `accepted` on `ambiguous` | as `update`, against the chosen target (`decision_detail.intoElementId`) |
| `accepted` on `gone` | the retirement update or retract, confidence 0.50 |
| `accepted` on a `changes`-section retire/restore (§5.6, Sprint F2b) | `element.update lifecycleStatus`, same provenance as any other `update`. `replaced_by` is a separate `replaces` relationship candidate (§5.6) — accepting *that* candidate as `new` additionally retracts every one of the retiring element's own live `supports` edges and re-creates each from the replacement at `role: 'secondary'`, description carried over; same provenance as the `replaces` delta itself |
| `merged` (`m` on a `new`) | the candidate's attributes become `element.update`s against the chosen existing element, one per attribute whose value differs, plus a `name` alias |
| `edited` (`e`) | the reviewer's values, `sourceId` = the reviewer's manual source, `confidence = 1.0`; `resolved_conflicts` row; for `unsourced`/`invalid`, `e` also supplies a `sourceRef` (typed, or picked in the source pane) and the candidate is re-grounded before it can be applied |
| `split` (`s`) | `element.create` (or update) carrying only `decision_detail.acceptedAttributes`; the rest recorded as rejected attribute-by-attribute in `decision_detail` |
| `rejected` | nothing |

`s` at the draft level ("send selected deltas to a different change branch", UI §5.2) is simply an apply call with a different `p_target_branch_id` for a subset — the function is called once per target.

**Amended 2026-10-06 — finishing a review with nothing to apply.** Apply needs a draft `change` branch as its target even when every remaining decision is `rejected`, which promotes nothing — so a reviewer who rejected everything had to create an empty change just to close the review, and until they did the draft sat in the review queue. `atlas.finish_capture_review(p_job_id)` (`20261006010000_finish_capture_review.sql`; security definer, contributor+ on the org, job must be `parsed`) closes it instead: it refuses while any candidate is undecided (`CANDIDATES_UNDECIDED`) or while any non-`rejected` candidate has no `promoted_commit_id` (`CANDIDATES_UNAPPLIED` — that still needs a real apply), then sets `status = 'reviewed'` and archives the draft branch, exactly as apply's step 5 does. It writes no commit, no deltas and no `target_branch_id`; rejections stay recorded on the candidate rows. The review page shows **Finish review** in place of **Apply decisions** whenever `src/capture/finishableWithoutApply.ts` (the client-side mirror of that gate) holds, and `⌘/Ctrl+Enter` does the same. A draft nobody means to review at all is discarded instead (§3.2), from the review page, the capture list or the review queue.

---

## 9. Re-import diff

### 9.1 Row key

`row_key` identifies "the same row" across runs of the same document lineage, computed in priority order:

1. `atlasId` column value, when present and resolved — `id:{uuid}`.
2. `sourceKey` column value — `key:{normalised value}`.
3. `name:{type}:{normaliseName(name)}:{normaliseName(parent name) | ''}` — the same triple intra-document grouping uses.

For prose, only rule 3 applies. A relationship candidate's key is `rel:{type}:{fromKey}→{toKey}`.

### 9.2 Diff

When `capture_jobs.reimport_of_job_id` is set (the user picks "this replaces…" at upload; the client offers the most recent `parsed`/`reviewed` job with the same `input_name` as the default), the classify stage compares this run's candidate set against the previous job's `capture_candidates`, by `row_key`:

| Previous run | This run | `reimport_status` | Class |
|---|---|---|---|
| absent | present | `new` | as §4.4 (`new` if unmatched on main; `update`/`confirm`… if the model already has it from elsewhere) |
| present | present, ≥ 1 attribute value differs from the *previous candidate's proposal* | `changed` | as §4.4 against main (the diff is informational; class is still decided against main's current facts) |
| present | present, no attribute differs | `unchanged` | as §4.4 — usually `confirm` |
| present | absent | `gone` | `gone` (K-14), evidence = the previous run's passage, `sourceRef` = the previous run's ref with a `reimport-diff` extractor |

A `gone` candidate is created only for previous candidates that were `accepted`/`merged`/`edited` last time — a row the reviewer rejected last quarter and that has since vanished is not news.

The review queue shows the diff summary in the job's header (`38 new · 129 changed · 231 unchanged · 6 gone`) and lets the reviewer filter units by `reimport_status`. Nothing about a re-import bypasses review; it only changes what the reviewer is told.

### 9.3 Same file again

A run whose `input_sha256` equals its `reimport_of_job_id`'s is allowed (main may have moved, so the classes may differ) but the upload dialog says so.

### 9.4 "Not in file" (Sprint F2b, always available)

Folded in from F2-lite, and widened while being folded in: F2-lite's own "not in file" summary (model elements a run never touched, shown as a question on the change page — never a retraction) needed no `reimport_of_job_id` chaining at all, unlike §9.1–§9.3's `gone` class, which only exists between two runs of *the same document lineage*. K1 gains the same summary unconditionally: every job's own `stats` already records which element ids its candidates matched or created, so the job page can compute "model elements of the types this run could address, that this run didn't touch" for *any* job, re-import or not, by diffing that set against `elements_head`. Shown as a plain list, never staged as a candidate and never auto-actioned — a person decides whether an absence means something (most often: file a `changes` entry, §5.6, on a follow-up run) or means nothing (the document was never meant to be exhaustive). Scope matches F2-lite's own: systems and containers only — a capability or actor absent from a register was never something this kind of document would exhaustively list.

---

## 10. What the review queue shows

The layout, keys and three panes are UI-principles §5, unchanged. This section fixes what the **centre pane** contains per class and what the keys do for each, so K1 builds the queue against a decided design. Route: `/o/{org}/m/{model}/review/capture/{captureJobId}` (UI §2.4).

**Every unit** shows: type glyph and name as it will appear on the element page; the attribute rows with the proposed value and the badge the accepted fact would carry (`⚙ · age from document_date · dots from confidence`); the match line (`Matched: alias "PowerOn" → PowerON` / `Matched: name+context 0.71 → Tenants Portal (in Housing)` / `Matched: none (new)` / `Matched: Atlas id`); `Similar:` entries at 0.50–0.60 with `⚠`; **any alias proposals this candidate carries** ("Will also remember: name \"PowerON\", source_system_key \"APP-101\"") — not only on a `new` candidate: §7.6's level-2/3 match and intra-document-group aliases attach to matched classes too, and a reviewer accepting or merging any of them is still teaching the matcher something (amended, issue #284 — `capture_candidates.alias_proposals`, persisted from PR8's own `aliasProposals` that PR10 already threaded through but PR12 never wrote to a column); warnings from `evidence.warnings` as short chips (`date assumed dd/mm`, `status "Live" read as active`, `column mapped by AI 0.72`); and, on the right, the source passage with the extractor's cells/span highlighted.

| Class | Centre pane adds | Keys |
|---|---|---|
| `new` | "Will create {type} {name}" with parent breadcrumb; the alias proposals that would be recorded. | `a` accept, `m` merge into… (picker prefilled with `similar`, then search), `s` split attributes, `e` edit, `r` reject; `x` multi-select then `a` bulk-accepts (Sprint F2b) |
| `update` | Two-column rows for each differing attribute: **main now** (value, badge, provenance card on hover) vs **proposed** (value, badge). Unchanged attributes collapsed under "n unchanged". | `a`, `s` (choose which attributes), `e`, `r` |
| `confirm` | One line per attribute: "unchanged — provenance refreshed to this document". Listed in a collapsed "Confirmations (231)" group, pre-staged accepted; `x` multi-select then `r` excludes or (Sprint F2b) `a` bulk-accepts (redundant with the pre-staged default, useful after `x`+`r` on a subset to re-confirm the rest explicitly). | `a`, `r`, `x` |
| `conflict` | Three columns like a merge-request field conflict: **main now** (value, source, date, confidence, author), **proposed** (value, source, date, confidence), and the reason it is a conflict ("main's value is from an interview 2 months ago, confidence 1.0; the document is dated 14 months ago"). | `a` (take proposed), `r` (keep main — recorded as rejected with reason `kept_main`), `e` (enter a value) |
| `ambiguous` | The top candidates side by side (name, parent breadcrumb, score, their own current attribute values). `a` is disabled with the hint "choose a target first". | `1`–`5` choose target (then `a` enabled), `m` (open picker for something else), `n` ("none of these — treat as new"), `e`, `r` |
| `gone` | "Present in {previous run name} on {date}, absent from this document." The previous passage on the right. The proposed retirement (or retract) and the low badge (`●○○ 0.50`). | `a` accept retirement, `r` ignore (recorded; not proposed again for this lineage until the row reappears), `e` (e.g. set `plannedEnd` instead) |
| `invalid` | Red bar with the reason (`PARENT_UNRESOLVED "Housing Platform"`, `ILLEGAL_RELATIONSHIP actor uses capability`, `DUPLICATE_RELATIONSHIP supports already exists`). No proposed badge. | `e` only (fix the parent/endpoint via picker, or the type); `r` |
| `unsourced` | Red bar: "No passage found for this fact in the source." The model's claimed text shown in a distinct "claimed" style, not as evidence. | `e` (attach a source ref by selecting in the source pane, then re-grounded), `r` |

Relationship units render as `type · from → to` with the endpoint elements' breadcrumbs, and for `supports` the primary/secondary flag with the K-13 note when the candidate was demoted to secondary because a primary already exists; `owns` shows its `role` (business/technical/service) directly, and `uses`/`flows_to` show `via` when the row named an integration platform.

**Queue-level.** The left pane groups units by class in the order `unsourced, invalid, duplicate_in_target, ambiguous, conflict, new, update, gone, confirm` (`duplicate_in_target` amended in, issue #285 — beside `invalid`/`unsourced`, no delta, needs the reviewer's attention first) — things that need a decision first, bulk-accepted confirmations last. Filters: class, `reimport_status`, sheet, warning code. The header shows `stats`, the diff summary (§9.2), the target branch (`t`), and the "Apply decisions" button state with its reason when disabled (`2 unsourced candidates are staged accepted` can't happen — `a` is blocked on them — but `target branch not chosen` and `target branch is under review (proposed)` can).

**Amended, Sprint F2b — multi-select widened to `new` and bulk-accept added.** Before this sprint, `x` multi-select existed only for `confirm`, and its only bulk action was `r` (reject a subset). Folding F2-lite in without this would be a real regression for the common case it handled well: a clean register that resolves to all-`confirm`/all-exact-`new` candidates went from F2-lite's one-shot commit to a queue that needed one keystroke per row. `x` now also multi-selects within `new`, and `a` on a multi-selection bulk-accepts every selected candidate (same guard shape as the existing bulk-`r`, same `⌘/Ctrl+Enter` apply afterwards) — a clean import is still select-all-then-accept-then-apply, three actions regardless of row count, not `a` once per row.

**Amended 2026-10-06 — bulk actions and discard without a keyboard.** `x`/`a`/`r` had no on-screen equivalent, so on a phone bulk-accept didn't exist. Each `new`/`confirm` group header now has **Select all** / **Deselect all**, and a non-empty selection shows a sticky bar with **Accept selected**, **Reject selected** and **Clear** — the same `decideMany` call `a`/`r` make. The page also offers **Discard this draft…** (two-step; `atlas.discard_capture_job`, so the creator or an owner/architect only), and a job that is no longer `parsed` renders as closed with a link back to the queue rather than as an actionable queue. The review queue's "Capture drafts" list has a Discard per row and, for a file with more than one draft waiting, one **Discard N older copies** action that keeps only the newest (`src/ui/capture/olderDuplicateDrafts.ts`).

`⌘/Ctrl+Enter` applies §8.2 (or finishes the review, per §8.2's 2026-10-06 amendment). Progress and session tally are as UI §5.1.

---

## 11. Failure modes

Every failure has a code, a place it is recorded, and a surface. Nothing fails silently; nothing is faked past.

| Code | When | Recorded | Surfaced |
|---|---|---|---|
| `INPUT_TOO_LARGE` | K-16 limit exceeded | rejected at upload (client) or `capture_jobs.error` if detected in parse | upload dialog error with the limit and the actual size; job list shows "failed" with the reason |
| `INPUT_ENCRYPTED` | password-protected workbook/PDF | `error` | same; "remove the password and upload again" |
| `INPUT_UNREADABLE` | parser throws (corrupt file, wrong extension) | `error` | same, with the parser's message |
| `NO_TEXT_LAYER` | every PDF page < 20 chars | `error` | "This PDF is scanned. Capture can't read images yet (§15); export the text or paste it." |
| `NO_USABLE_SHEET` | every sheet skipped | `error`, `stats.sheetsSkipped` with per-sheet reasons | job page lists each sheet and why |
| `SHEET_NO_HEADER`, `SHEET_NO_NAME_COLUMN` | one sheet skipped | `stats.sheetsSkipped` | job header: "2 sheets skipped" expandable |
| `LLM_REFUSAL` | `stop_reason = 'refusal'` | `error` with `stop_details.category`; the chunk id | job fails; message names the chunk/pages so the person can inspect the input; retry allowed |
| `LLM_TRUNCATED` | `stop_reason = 'max_tokens'` | retried once with the chunk split in half; then `error` | as above |
| `LLM_SCHEMA_INVALID` | response fails the strict schema (should not happen with structured outputs; defensive) | retried once; then `error` | as above |
| `LLM_UNAVAILABLE` | proxy/API 429/5xx/timeout after the SDK's retries | `progress.retryAfter`; `error` after 3 step-level retries | the client shows "waiting for the AI service" and keeps re-invoking; after the limit, a retry button |
| `LLM_BUDGET_EXCEEDED` | the proxy's per-org cap (ADR-014) | `error` | names the cap; owner-only action to raise it lives outside this product |
| `PASSAGE_NOT_FOUND` | grounding failed for a fact | fact dropped, `evidence.warnings`; whole candidate `unsourced` if it was the name | class `unsourced` in the queue (§10) |
| `CAPABILITY_CODE_UNKNOWN` | prompt C returned a code not in the tree | assignment dropped, `stats.warnings` | the row's `supports` simply isn't proposed; the sheet warning count shows it |
| `LOW_MAPPING_CONFIDENCE` | column mapped by AI < 0.70 | `evidence.warnings` per candidate | chip on every affected unit; header count |
| `PARENT_UNRESOLVED`, `ENDPOINT_UNRESOLVED` | text names something nowhere in the run or on main | class `invalid` | red bar with the text; `e` opens a picker |
| `ILLEGAL_RELATIONSHIP` | C9 triple not allowed | class `invalid` | red bar naming the triple |
| `DUPLICATE_RELATIONSHIP` | S-6 duplicate of a live edge | class `confirm` if attributes equal, else `update`; `invalid` only if the endpoints resolve to *candidates* that would create a second edge in the same commit | as its class |
| `PRIMARY_DEMOTED` | K-13 demoted a proposed primary | `evidence.warnings` | note on the relationship unit |
| `ATLAS_ID_NOT_FOUND` | `atlasId` column value not in the model | `match.warnings` | chip "Atlas id not found — matched by name instead / treated as new" |
| `ALIAS_COLLISION` | a learned alias already resolves to a different element | alias skipped, `stats.warnings`, and the pair is written to the job's `stats.identityWarnings` for the Q1 duplicates report | job header count; unit chip |
| `TARGET_RETRACTED` | at apply time, the matched element no longer exists on the target branch head | candidate returned as `invalid` with this code; the whole apply is rolled back | queue shows the affected units at the top; the reviewer re-decides |
| `TARGET_BRANCH_NOT_DRAFT` | target branch is `proposed`/`approved`/`merged` | apply refused | "Apply" disabled with the reason; `t` to choose another |
| `DRAFT_HEAD_MOVED` | should be impossible (drafts are written once); guarded anyway | apply refused | "This draft was modified outside the queue — reload" |
| `RUN_INTERRUPTED` | the function died mid-step | `progress` shows the last completed chunk; nothing else | the client's next invoke resumes; the job page shows "resuming from page 41" |
| `IDENTICAL_INPUT` | `input_sha256` equals the previous run's | informational in `stats.reimport` | upload dialog note (§9.3) |

`capture_jobs.error` holds `{code, message, detail?}` as text (JSON) so the job list can render it without a second table.

---

## 12. Evaluation

The pipeline is done when it passes this, not when the UI looks right (Prompt 11).

### 12.1 Layout

```
src/capture/fixtures/
  README.md                       what a fixture is, how to add one, how to record cassettes
  01-clean-register/
    input.csv
    model.json                    pre-existing model state (elements, relationships, aliases) — may be empty
    options.json                  { inputKind, documentDate, reimportOf?: "<fixture id>", targetBranch?: … }
    expected.json                 ExpectedOutcome (§12.3)
    llm/                          recorded responses, keyed by request hash (RecordedLlmClient)
  02-…/
scripts/scoreCapture.ts           `pnpm capture:score [--live] [--fixture <id>] [--json]`
docs/review/capture-scores.md     generated by --live; committed with each prompt/model change
```

`model.json` is loaded into an in-memory `MatchIndex` for `pnpm test`/replay, and into a real local Supabase model (through `commit_deltas` and `aliases` inserts) for the integration run (`pnpm test:integration`), so the fixtures exercise both the pure matcher and the real read path.

### 12.2 The fixtures

Every fixture is deliberately messy in a *named* way; the expected outcome lists what a correct pipeline must and must not produce. Sizes are small enough to hand-verify (10–40 rows) except 07 and 08. **Amended, Sprint F2b:** fixtures 11–12 exercise this sprint's own additions (§5.2's mixed system/module sheet, §5.2a's Relationships sheet, §5.2's owner/capability syntax, §5.6's JSON input) — each deliberately smaller than 10–40 rows, closer to fixture 04's own precedent, since the point of each is one specific mechanism rather than a realistic-sized register.

| # | Fixture | Input | Model state | What it tests | Expected outcome (summary) |
|---|---|---|---|---|---|
| 01 | `clean-register` | CSV, 12 rows, headers `Application, Supplier, Status, Go-live, Business owner, Service area` | empty model seeded with `local_government_scotland` v1 capabilities | the happy path; synonym mapping only (no LLM call for mapping); capability assignment via alias/name match against seeded capabilities, prompt C for the two rows whose "Service area" doesn't match | 12 `new` systems, each with vendor/lifecycle/introduced; 12 `new` actors (teams) + 12 `owns` (all `role: 'business'`); ≥ 10 `supports` with the named capability codes; 0 `invalid`, 0 `unsourced`; every confidence in [0.85, 0.95] except defaulted `isExternal` at 0.60 |
| 02 | `odd-headers` | XLSX, 18 rows, headers `Solution, Who supplies it, Live?, Retire by, Accountable, Directorate, Ref no., Hosted where` plus a title row and a "Generated 03/04/2026" banner | empty + seeded capabilities | header detection past banner rows; prompt A mapping for every column; `Live?` → lifecycle booleans (`Y`/`N` → active/retired); `Hosted where` → isExternal + externalOrganisation; `Ref no.` → `source_system_key` aliases | 18 `new` systems; mapping cassette produces the expected roles; `LOW_MAPPING_CONFIDENCE` on ≤ 1 column; 18 `source_system_key` alias proposals; `Live? = N` rows have `lifecycleStatus: retired` with `ENUM_FUZZY` |
| 03 | `roundtrip-export` | CSV exported by Atlas itself: `Atlas ID, Name, Vendor, Lifecycle, …`, 15 rows; 2 rows carry an id that was merged away; 1 carries an id from another model | 15 systems on main with those ids; 2 `merged_id` aliases; facts with mixed sources | level 1 matching incl. `merged_id` resolution; `confirm` vs `update`; `conflict` strength rule | 12 `confirm` (values unchanged), 2 `update` (vendor changed, main's fact is a capture from 2 years ago), 1 `conflict` (lifecycle differs, main's fact is manual 1.0 dated last month), 2 `RESOLVED_THROUGH_MERGED_ID`, 1 `ATLAS_ID_NOT_FOUND` falling through to a level-3 match |
| 04 | `duplicates-within` | CSV, 20 rows in which `PowerON`, `Power On`, `PowerOn (Enzen)` and `POWERON` appear as separate rows with partially disagreeing vendors | empty | intra-document grouping; `ROWS_DISAGREE`; alias proposals for every variant | 17 `new` systems (4 rows → 1 candidate); the PowerON candidate has 4 `attributeRefs` rows, a `ROWS_DISAGREE` warning on vendor, and 4 `name` alias proposals; no two `new` candidates share a normalised name |
| 05 | `aliases-known` | CSV, 10 rows using old names (`Northgate Housing`, `SX3`, `iWorld`) | 10 systems on main under new names, with `name` aliases for the old ones; one alias string is within 0.7 trigram of a *different* system's name | level 2 beats level 3 (P-19) | 10 `confirm`/`update`, all `level: alias`; the trap row matches its alias's element, not the trigram neighbour; 0 `new` |
| 06 | `containers-two-sheets` | XLSX: sheet `Systems` (6 rows) and sheet `Modules` (14 rows, `Module, Parent system, Technology`); `Portal` appears as a module under two different systems; one module names a parent not on either sheet | 3 of the 6 systems already on main, one with an existing `Portal` container | sheet type inference (`container` from `parent` column); cross-sheet parent resolution to candidates; context in level 3 (P-20); `PARENT_UNRESOLVED` | 3 `new` + 3 `confirm` systems; 12 containers: the `Portal` under the existing system is `confirm`, the `Portal` under a new system is `new` (never matched to the other); 1 `invalid` (`PARENT_UNRESOLVED "Legacy CRM"`) |
| 07 | `merged-cells-and-junk` | XLSX, 60 rows: merged header cells across two rows, a totals row, 3 blank rows mid-table, dates as `Mar-19`, `2021`, `31/12/2027`, `12/31/2027`, a `Vendor` cell `Civica / Northgate`, `#REF!` in one cell, a "Notes" column with long prose | empty | parser robustness; date parsing table; `MULTI_VALUE_CELL`; `FORMULA_ERROR`; the totals row is not a system | 60 → 56 `new` systems (totals + 3 blanks excluded); dates parse to `2019-03-01` (ambiguous), `2021-01-01` (ambiguous), `2027-12-31` (exact, both spellings); warnings counted exactly; `rowFactor` 0.95 applied to the `#REF!` row |
| 08 | `pdf-catalogue` | text PDF, 9 pages: a title page, a table of applications spanning pages 2–7 with repeating headers/footers, a narrative "Integration landscape" section on pages 8–9 stating flows ("The CRM sends nightly extracts to the data warehouse") and ownership | empty + seeded `nhs` capabilities | prompt B extraction per chunk; grounding (byte-exact and normalised); relationships from prose; cross-chunk endpoint resolution; page headers not extracted as systems | ≥ 24 of 26 catalogue systems as `new` with vendor and status (recall ≥ 0.92); 0 candidates named after the page footer; ≥ 4 `flows_to` and ≥ 3 `owns` from the narrative, each with a passage found on page 8 or 9; every `sourceRef` resolves; ≤ 2 `unsourced` |
| 09 | `scanned` | image-only PDF, 3 pages | empty | `NO_TEXT_LAYER` | job fails at parse with `NO_TEXT_LAYER`; no branch, no source row, no candidates; `error` set; job retryable |
| 10 | `pasted-notes` | 1,800 chars of meeting notes: "The housing team (Housing Digital) own the tenant portal, which Civica supply; it's due to be replaced by Q2 2027 when the new Open Housing platform goes live. Finance still run Agresso on-prem. Nobody could say who owns the data warehouse." | 2 systems on main (`Tenant Portal`, `Agresso`), team `Housing Digital` | prose → multiple facts per passage; `plannedEnd` from "Q2 2027"; `planned` lifecycle from "goes live"; `owns` to an existing actor; an explicit statement of *not knowing* produces nothing | `Tenant Portal` → `update` (vendor Civica, plannedEnd `2027-04-01` with `AMBIGUOUS_DATE`), `owns Housing Digital → Tenant Portal` as `confirm`/`new` per model state; `Open Housing` → `new` system `lifecycleStatus: planned`; `Agresso` → `confirm`/`update` (`isExternal: false` from "on-prem"); `Data Warehouse` → `new` with **no** `owns` and no owner actor; 0 `invalid` |
| 11 | `mixed-sheet-relationships` (Sprint F2b) | XLSX, one "Applications" sheet mixing a top-level system (`CRM`, blank `Parent system`) and its own module (`Portal`, `Parent system: CRM`), an owner cell `Ofgem (External: Energy regulator)` and a `|`-delimited `Capability: Billing\|Reporting` cell on `CRM`; a second "Relationships" sheet (`CRM flows_to Portal`) | 2 capabilities on main (`Billing`, `Reporting`) | per-row mixed system/module split via `inferSheetType`/`rowsToCandidates.ts` (not forced to `container` at the sheet level, §5.2's own Sprint F2b amendment); the Relationships sheet resolving against the same run's own new systems; owner-external syntax; pipe-delimited capability list | `CRM` → `new` system; `Portal` → `new` container, `parent` resolved to `CRM`; `Jane Doe`/`John Smith` → `new` person actors (`owns` business/technical to `CRM`); `Ofgem` → `new` organisation actor (`isExternal: true`, `externalOrganisation: "Energy regulator"`, `owns` business to `Portal`); `CRM flows_to Portal`; `CRM supports Billing`/`CRM supports Reporting`, both `role: 'secondary'` (two targets, neither primary-eligible); no LLM call (every header is a checked-in synonym) |
| 12 | `json-retire-restore` (Sprint F2b) | JSON: `systems: [Electron]`; `changes: [{name: "Legacy CRM", action: "retire", replaced_by: "Electron"}, {name: "Old Reports", action: "restore"}]`, neither `changes` entry states its own `confidence` | `Legacy CRM` (active, confidence 1.0 — a manual assertion) and `Old Reports` (retired, confidence 0.5 — an older capture) on main | §5.6's `changes` section; `replaced_by` proposing a separate `replaces` candidate resolved against main; the JSON confidence cap (§5.6) interacting with §4.4's own conflict-strength rule; `mustMatchExisting` (an unresolved name is `invalid`, never `new`) | `Electron` → `new`; `Legacy CRM` → `conflict` (its own 0.90-capped retire is *weaker* than main's existing 1.0-confidence fact — correctly flagged for review, not silently applied); `Old Reports` → `update` (0.90 beats main's own 0.5); both retire/restore candidates report `confidence: 0.90`, not the 1.0 F2-lite defaulted to and not the 0 a Sprint F2b bug briefly floored them at (§5.5's own amendment note); `replaces Electron→Legacy CRM` → `new` |

Fixture 03 doubles as a re-import case: `options.reimportOf` points at a synthetic previous job built from the same model state, with 2 rows removed from `input.csv`, so `expected.json` also asserts 2 `gone` candidates (both systems, proposal `lifecycleStatus: retired`, confidence 0.50) and the `reimport` counts in `stats`.

### 12.3 `expected.json`

```ts
export type ExpectedOutcome = {
  /** Whole-job expectations. */
  job: { status: 'parsed' | 'failed'; errorCode?: string; stats?: Partial<CaptureStats> };
  /** Candidates that must exist, keyed by row_key. Unlisted attributes are unconstrained; listed ones must deep-equal. */
  candidates: Record<string, {
    kind: 'element' | 'relationship';
    class: CandidateClass;
    elementType?: ElementType; relationshipType?: RelationshipType;
    matchLevel?: MatchLevel; matchElement?: string;          // matchElement is a model.json element key
    attributes?: Record<string, unknown>;
    confidence?: { min: number; max: number };
    warnings?: string[];                                       // must be present (subset)
    aliasProposals?: { type: AliasType; value: string }[];
  }>;
  /** Row keys that must NOT appear as candidates (footers, totals, non-taxonomy things). */
  absent: string[];
  /** Tolerances for LLM-backed fixtures in live mode (§12.6); ignored in replay. */
  live?: { minElementRecall: number; minElementPrecision: number; maxUnsourced: number };
};
```

### 12.4 Scoring script

`scripts/scoreCapture.ts` runs every fixture (or `--fixture <id>`) through `runCapture()` — the same function the edge function calls, with `RecordedLlmClient` in replay mode — and computes, per fixture and overall:

| Metric | Definition | Gate (replay) |
|---|---|---|
| element recall | expected element candidates found (by `row_key`) / expected | 1.00 |
| element precision | found candidates that are expected or unconstrained / found; any `absent` key found is a hard fail | 1.00 |
| class accuracy | candidates whose class equals expected / candidates with an expected class | 1.00 |
| match accuracy | candidates whose `matchLevel` and `matchElement` equal expected / candidates with an expected match | 1.00 |
| false-merge count | candidates matched to an element the expectation says is a different thing | 0 (hard fail) |
| attribute accuracy | listed attribute values deep-equal / listed | 1.00 |
| relationship recall / precision | as for elements, over relationship candidates | 1.00 / 1.00 |
| confidence in range | candidates with a listed range whose confidence is inside it / listed | 1.00 |
| calibration | across all fixtures, share of `high`-band (≥ 0.90) candidates whose class is not `invalid`/`unsourced` and whose match/attributes are correct | ≥ 0.95 |
| determinism | running the fixture twice yields byte-identical candidate sets after ids are masked | required |
| failure exactness | for a `failed` fixture, `errorCode` equals expected and no branch/source/candidate rows were written | required |

Replay mode must reach every gate: it is the regression suite and is part of `pnpm test` (each fixture is a Vitest case in `src/capture/fixtures.test.ts` calling the same scorer, so `pnpm test` fails on a regression — the script is a human-readable report over the same numbers, not a second oracle).

`--json` prints the per-fixture metrics as one JSON object for the sprint summary. Exit code 1 if any gate fails.

### 12.5 Integration mode

`pnpm test:integration` includes `src/capture/pipeline.integration.test.ts`: for fixtures 01, 03, 05 and 06, load `model.json` into a real local model, run `capture-run`'s step function against it with the recorded client, and assert (a) the draft branch/commit/deltas exist with the expected counts, (b) `foldFromGenesis(draft head)` equals the in-memory fold the unit run produced (head hash), (c) RLS: a viewer sees no `capture_candidates` rows and no draft branch, a contributor sees both, (d) `atlas.apply_capture_decisions` with an all-accept staging writes one commit on a fresh change branch whose fold contains the promoted elements under new ids, the aliases exist, the job is `reviewed` and the draft `archived`, (e) P-K2 trigram parity.

### 12.6 Live mode

`pnpm capture:score --live` uses `DirectLlmClient` (or the proxy) for fixtures 02, 08 and 10 (the LLM-dependent ones), records fresh cassettes into a scratch directory, and scores with the fixture's `live` tolerances instead of the replay gates (prose extraction is not byte-deterministic across model versions). It writes `docs/review/capture-scores.md`: per fixture, the metrics, the model id, `PROMPT_VERSION`, token usage and cost. Gates for live: element recall ≥ 0.92 and precision ≥ 0.95 on 08; every fixture's `maxUnsourced` respected; 0 false merges. A prompt or model change is not done until this file is regenerated and its gates pass, and the new cassettes are reviewed and committed as the fixture's `llm/` — that is how the replay suite tracks the live behaviour rather than freezing a stale one.

Cost of a live run is recorded in the same file; at K1's fixture sizes it is a few tens of thousands of tokens.

---

## 13. Tests that must exist (in addition to SPEC §10)

| Id | Test |
|---|---|
| RT-K1 | Arbitrary `CaptureCandidate` → JSON → `CaptureCandidate` deep-equal; `CaptureCandidate` → `capture_candidates` row → back, deep-equal. Arbitrary `CaptureJob` likewise against `capture_jobs` with the new columns. |
| RT-K2 | `atlas.write_capture_draft` with an arbitrary valid draft envelope → read back branch, commit, deltas (by `seq`), candidates (by `seq`) → equals the input. |
| RT-K3 | `formatSourceRef(parseSourceRef(s)) == s` for every grammar; `parseSourceRef` returns null on a hand-typed ref without throwing. |
| P-K1 | Determinism: same bytes, same model state, same cassette → identical candidate set (ids masked), identical `stats`. |
| P-K2 | TypeScript trigram similarity equals Postgres `similarity(lower(a), lower(b))` to 4 dp for 1,000 generated name pairs (integration). |
| P-K3 | Promotion never reuses a draft subject id; every relationship promoted alongside a promoted `new` element is re-pointed to the re-minted id; a promoted commit folds cleanly (C1–C17). |
| P-K4 | A `confirm` candidate's promoted deltas change no head value: `fold(target before)` and `fold(target after)` differ only in `facts[*].delta_id`/provenance for the confirmed keys. |
| P-K5 | For arbitrary rows proposing primary `supports`/`owns` against arbitrary main states, the draft envelope never fails C17. |
| P-K6 | For arbitrary candidate sets and decisions, `apply_capture_decisions` either commits everything (commit + aliases + candidate updates + resolved_conflicts) or nothing — inject a failure at each step and assert no partial state. |
| P-K7 | Access: viewer sees zero `capture_jobs`/`capture_candidates`/draft-branch rows; contributor sees their org's; nobody with an application role can insert/update `capture_candidates` directly. |
| P-K8 | Classification: for generated (candidate, main fact) pairs, `conflict` iff the value differs and main's fact is stronger by the §4.4 rule; `confirm` iff all values equal; `update` otherwise. |
| P-19, P-20, P-21 | SPEC §10.5, now runnable. |
| Playwright | `e2e/golden-path-capture-review.spec.ts` (renamed from this row's own original `capture-review.spec.ts` at PR16 — CLAUDE.md's coverage rule and `playwright.config.ts`'s `chromium-390` project both key off the literal `golden-path-*.spec.ts` prefix, so an unprefixed name would silently never run at 390 and would not count as coverage at all): upload fixture 01, wait for `parsed`, open the queue, `a` on the first `new`, `t` choose a branch, `⌘/Ctrl+Enter`, assert the element exists on the branch's to-be view with a `⚙` badge; `r` on a `new`, reload, assert it is still rejected. Fixture 09: assert the failure message. |

---

## 14. Questions for the human

Each is decided above under the stated recommendation, and the build proceeds on it; each changes the schema or touches an ADR-level statement, which is why it is asked rather than just recorded.

1. **K-1 vs UI-principles §4.3's example.** Keep the migrated `capture_job` source kind for every captured fact (⚙) and correct the worked example in UI-principles, or relax `sources`' CHECK so a capture run's source can carry the document's kind (`spreadsheet`/`document`, ▤/▣) *and* a `capture_job_id`? Recommendation: keep ⚙ — "machine-extracted, then reviewed" is a distinction a reader should see; the alternative needs a migration and blurs it.
2. **K-2 `capture_candidates`.** A new table rather than a jsonb column on `capture_jobs`. Recommendation: the table — it is queried per class, per decision and per `row_key` across jobs (re-import), which a jsonb blob does badly at 2,000 candidates.
3. **K-4 re-minting ids on promotion.** The alternative is to amend C5 so that a `capture_draft` create's id may be reused by exactly one promotion. Recommendation: re-mint — C5's simplicity ("an id appears once, anywhere") is worth more than a stable id on something that is by definition provisional, and `promoted_subject_id` keeps the trail.
4. **K-6 confirmations write deltas.** A quarterly re-import of a 2,000-row register adds up to ~6,000 value-equal update deltas. Recommendation: accept it — the staleness signal needs exactly this evidence, and history is append-only by design (ADR-002's own stated consequence). If storage ever matters, compaction is the ADR-002 follow-up, not skipping provenance.
5. **K-15 skipping the `type_schemas` generator for K1.** SPEC §11 named K1 as the sprint that would need it. Recommendation: defer again, with the reasoning recorded in §11's row — the edge function imports the TypeScript contracts, so there is no non-TS consumer yet.

---

## 15. Deferred

The first six rows below were true when this section was written (mid-build, against F2-lite alone) and are kept as the historical record of what F2-lite didn't cover; each is now built, so its own "Target" column names the PR rather than "F2 (full K1)". Only "Starter-map upgrade flow" remains genuinely open past PR16.

| Item | Why not K1 (as of the mid-build amendment) | Target |
|---|---|---|
| PDF and pasted-text extraction (§5.3, §6.2) | "F2-lite" (#198–#204, #209, 2026-09-18) covers spreadsheet/CSV/JSON only, against a fixed column schema — K1's other two input kinds need the LLM extraction path this scope didn't build | done — PR11 |
| `capture_jobs`/`capture_candidates` tables and the `capture-run` edge function (§3.2, §3.3, §3.5) | F2-lite reuses an ordinary change branch and one coarse `RowOutcome` (`new`/`unchanged`/`changed`/`needs-pick`/`blocked`), not this spec's per-candidate table/class/edge-function shape | done — PR1 (schema/contracts), PR12 (edge function) |
| Candidate-class review queue built on the S1 review page (§10) | F2-lite reuses the existing change-branch banner/merge flow directly, not a queue keyed to `new`/`update`/`confirm`/`conflict`/`ambiguous`/`gone`/`invalid`/`unsourced` | done — PR15 (`edited` on an `invalid`/`unsourced` candidate is the one narrower-than-spec surface it ships with — see that PR's own disclosed gap: re-grounding needs the original document, which nothing in this pipeline retains past the one `capture-run` invocation) |
| Re-import diff with `row_key` lineage across runs (§9) | F2-lite's `notInFile.ts` compares once against the current model via `sources.import_touched_element_ids`, not `capture_jobs.reimport_of_job_id` chaining | done — PR9 |
| Aliases learned from capture specifically (§7.6) | F2-lite's alias-on-confirm is a narrower, ad hoc version scoped to its own reconciliation flow, not matcher-level learning | done — PR8 (`buildPromotionEnvelope.ts`), narrowed to what a persisted `CaptureCandidate` can express — see that PR's own disclosed gap on `source_system_key`/intra-document-group aliases |
| Ten-fixture set and scoring script (§12) | this spec's own stated exit bar ("done when it passes the fixtures") — none exist; F2-lite was verified by unit/integration/e2e tests instead | done — PR10 (01–07), PR13 (08–10 + `pnpm capture:score --live`); fixture 08 itself still has no recorded cassette (needs a live Anthropic key this sandbox never had) and is honestly `SKIP`ped, not faked green |
| Starter-map upgrade flow | rides on the full K1 pipeline, not on F2-lite's deterministic-file path (tracked separately in `docs/prompts/atlas-prompt-pack.md`'s own register) | F2 (full K1) is now built, so this is unblocked — still not started; a follow-on sprint, not part of PR1–16 |
| OCR for scanned PDFs | a different pipeline stage (image → text) with its own error profile; `NO_TEXT_LAYER` names the gap honestly | unscheduled |
| `.docx`, `.pptx`, email inputs | "spreadsheets, PDFs and text" is the brief; each is a parser plus nothing new downstream | after K1, on demand |
| Batch API for large PDFs | 200 pages ≈ 20 calls; interactive latency is fine at K1's limits. Batches halve cost once runs are routinely large | K2 |
| `atlas.merge_elements` from the queue (`m` on an `ambiguous` pair of *existing* elements) | ADR-019/SPEC §11: Q1, with the duplicates report. Capture's `m` today converts a `new` into updates against one existing element, which needs no merge procedure | Q1 |
| Capability *creation* from capture (a document that names a capability the map lacks) | prompt C is closed-vocabulary by design; a missing capability is a tailoring decision on the capability map, not an extraction | never automatic; a reviewer adds it on the map and re-runs |
| `uses`/`flows_to` required `label` (Decisions from use) | the contract has `description?` only today; when `label` lands, prompt B's relationship schema gains it and the row-to-candidate code copies the verb phrase | with that contract change |
| Per-model thresholds | global constants (UI §10 decision 2); a settings row + lookup if ever wanted | unscheduled |

### AI change briefs

A `change_brief` is proposed future work. It uses the same private storage, candidate evidence and review flow as pasted text. The worker requires the organisation AI setting and checks the job’s model and storage path before reading data. The provider receives up to 4,000 characters of brief plus bounded model context. A brief cannot be a re-import. Promotion targets a draft Propose branch and skips Capture’s immediate Record/Correct merge action.
