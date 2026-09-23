# ADR-023: Value streams — one element type, one relationship type

**Status:** Proposed 2026-09-21 — Step 1 of the F6 sprint (prompt pack F6: "written and decided before any code"); approved for build the same day. Step 2 carries the migration, `supabase/migrations/20260921070000_value_streams.sql`; this ADR becomes Accepted when that PR merges to `main`.
**Numbering:** ADR-022 is the current highest (`docs/ADR-022-decisions-schema.md`), so this is ADR-023. `docs/ADR-000-foundations.md`'s own index gains a one-line pointer to this file, per that document's established convention for ADR-021 and every later one.
**Depends on:** ADR-001 (`docs/ADR-000-foundations.md`, the taxonomy this ADR extends — including its "explicit non-types" list, which this ADR has to argue against), ADR-007 (per-fact provenance — why `enables` is a relationship, not a list attribute), ADR-012 (starter maps — value streams become part of a sector map's content), ADR-013/022 (decisions — "affected value streams" on a comparison row), F0 (`branches.intent` — the edit gate is expressed in intents), F5 (roadmap — the group-by this ADR adds a second mode to).

## Context

Prompt pack F6 reserves exactly one taxonomy addition beyond ADR-001's four element types and four relationship types: "value stream → stages, `enables` from capability to stage; one view; no other taxonomy change." Everything the sprint builds — a rollup, an extra impact hop, four views, editing, starter content, import — hangs off that one decision, so it is written and approved before any code (this document is the sprint's first PR, on its own).

Three things needed deciding that neither ADR-001 nor SPEC-data-model.md answers:

1. **Whether a value stream is the "business process" ADR-001 deliberately excluded.** ADR-001's Explicit non-types names "business processes/workflow steps (BPMN-shaped)" (`src/contracts/delta.ts`'s `DELIBERATELY_NOT_MODELLED`: `business-process`), precisely so a request like this one has to argue against a written decision rather than accrete. It does, below.
2. **Where structural edits to this layer may be made.** ADR-001's Consequences make adding a type "intentionally expensive"; the F6 brief goes further for the data itself — value streams are "the most stable layer," edited only through a `correct`-intent change reviewed by an architect, never inside a `propose` change, and deactivated rather than deleted. Nothing in the codebase gates an *action* on `branches.intent` today (`src/ui/changes/branchIntent.ts` only varies review weight and list grouping), so this is a new kind of rule and needs stating precisely.
3. **How "worst enabling capability" is defined.** The director door's tile tone (`src/db/modelHome.ts`'s `CapabilityTileData.tone`) has four values with no total order between them; a stage that rolls up several capabilities needs one.

## Decision

### Taxonomy

**`ElementType` gains `value_stream`** (five types: Capability, System, Container, Actor, Value stream). A *stream* is a `value_stream` element with `parentId: null`; a *stage* is a `value_stream` element whose `parentId` is a stream. Containment is the same structural `parentId` every other type uses (ADR-001: "contains" is a foreign key, never a relationship row), and depth is exactly two — a stage never has children. Stages are ordered among their siblings by the existing `order` attribute (Sprint U4-1 C1's capability convention, `src/contracts/attributeSchema.ts`), which is what "stages left to right" reads.

**`RelationshipType` gains `enables`** (six types, counting `replaces` — ADR-001's own amendment, merged the same day as this ADR was written): **capability → stage**, meaning "this capability is one of those that deliver this stage." No attributes, no cardinality cap in either direction — a capability commonly enables several stages across several streams, and a stage is usually enabled by more than one capability. `RELATIONSHIP_TYPE_RULES` gains one row, `(enables, capability, value_stream)`; the "stage, not stream" half of the rule is C22 below, because that table has never expressed anything finer than `(relationshipType, fromType, toType)` (its own "Platforms and modules" precedent says the same).

**Why this is not ADR-001's "business process".** A BPMN-shaped process has sequence semantics (a step *follows* another), timing, actors per step, and flow between steps. A value stream here has none of those: a stage is a **label that groups the capabilities that deliver it**, and the only ordering is display order (`order`), carrying no more meaning than the order of level-2 capabilities under a level-1. No stage has an owner (`owns` gains no `value_stream` row), no timing, no flow (`flows_to`/`uses` gain no rows either), and nothing can be modelled *between* two stages. Structurally it is one more grouping layer above capability — the same shape a level-1 capability is above its level-2s — pointed at outcomes rather than functions, which is exactly the "one business layer" ADR-001 said the taxonomy had to carry and the F6 brief asks to widen by one. `DELIBERATELY_NOT_MODELLED` keeps `business-process`; its doc comment gains the one-line pointer that value streams are this ADR's layer, not that exclusion's.

Attribute sets (same table shape as ADR-001's; required fields marked *req*):

| Type | Key fields |
|---|---|
| Value stream | `name` *req*, `description`, `order` (display order among siblings, reorder-control-written only, as for Capability), `inactive` (boolean), `inactiveSince` (date), `inactiveReason` (text) — the last three set together by the Deactivate action only, stream-level only (a stage follows its stream), never edited by hand in the attribute form |
| `enables` | none — `EnablesAttributes` is `{}` |

No `lifecycleStatus`, no `isExternal`, no owner: the F6 brief's own "no process modelling, no timings, no per-stage owners."

**Deactivation is three attributes, not a table and not a retract.** "A stream is deactivated (inactive flag, date, reason), never deleted": the flag, date and reason are ordinary facts on the stream, each with its own provenance (ADR-007), written by `element.update` deltas in one commit — reversible by the same mechanism (Reactivate clears all three), and an attribute-only addition needs no migration (ADR-001's Prompt 7k precedent). The only existing "deprecated" shape in this schema, `attribute_definitions.deprecated_at`, is a column on a *definition* row with no reason text; it is the wrong precedent for an element with history. `Remove from model…` (`useElementRemoveFromModel.ts`) and `Retire…` are **omitted** for `value_stream` — never shown disabled, the `ElementHeader.tsx` convention — since retract is the delete this layer must not have and `lifecycleStatus` isn't a field it carries. An inactive stream is still folded, still rolled up, still traversed for impact; views show it collapsed under an "Inactive" group rather than hidden.

### C22 — two cross-entity checks the rules table can't express

A new commit invariant, **C22**, in `src/engine/deltas.ts` alongside C18/C20, checked against the head as it stands when the delta is applied, at `create`/`update` and — matching C18's and C20's own convention — never re-run at `restore`:

- `element.create` of a `value_stream` with a non-null `parentId`, and `element.update` of `parentId` on one: the parent must be a live `value_stream` whose own `parentId` is `null`. (Depth two. A stage under a stage, or a stream under a capability, is rejected.)
- `relationship.create` of `enables`: `toElementId` must be a live `value_stream` with a non-null `parentId` — a stage, never a stream. (`fromElementId` being a capability is already C9 via the rules row.)

No database backstop — a cross-table (element ↔ its parent's own column; relationship ↔ its target's own column) dependency Postgres has no plain `CHECK` for, exactly the shape C18 already established engine-only enforcement as this taxonomy's accepted answer to. `COMMIT_INVARIANTS` and SPEC §5.2 list it; SPEC §10's P-8 generator set gains it.

### The edit gate — "main, or a correction"

**Structural edits to the value-stream layer** — creating, retracting, restoring, renaming, re-parenting, reordering or deactivating a stream or stage, **and creating or retracting an `enables` edge** — are offered:

- directly on `main`, to whoever `canEditOnMain` already admits (owner/architect — ADR-015's own floor, unchanged; this is the same rule every other element type has), and
- inside a change branch **only when `branch.intent === 'correct'`** and `canEditBranch` holds.

Inside a `record`, `propose` or `explore` change, the affordance is replaced by a short notice pointing to a correct-intent change ("Value streams change on main or in a correction. Open a correct-intent change to edit this."). The "reviewed by an architect" step the brief asks for is the existing single-approver merge for `correct` (`canApproveOrMergeRequest`, owner/architect only — UI-principles §10 decision 13); this ADR creates no second review mechanism. Two consequences worth stating plainly:

- **The gate is UI-only** (`src/ui/orgs/roleGates.ts`'s new `canEditValueStreamStructure(role, branch)`), never an engine invariant: `branches.intent` is a workflow concept the engine deliberately never reads (`branchIntent.ts`'s own principle, F0), and `atlas.commit_deltas` knows nothing of intent. A direct API caller can still commit a value-stream delta to a `propose` branch; what the gate governs is what the product *offers*, the same standing every other `roleGates.ts` gate has ("for showing/hiding the affordance; the database enforces the real rule regardless"). Recorded so nobody later reads the gate as a security boundary.
- **Import.** `useSpreadsheetImport.ts` commits every import to a fresh `record`-intent branch. That is the one write path that would otherwise bypass this gate, so: when an import file carries a `value_streams` section, the branch it creates is `correct`-intent instead — an import that restates structure is a correction of the record — and the dialog says so. A file with no `value_streams` section is unaffected. **Amended, Sprint F2b (2026-09-23):** `useSpreadsheetImport.ts` and its JSON `value_streams` section are retired along with the rest of F2-lite, folded into `docs/SPEC-capture.md`'s K1 capture pipeline (`docs/SPEC-capture.md`'s own Sprint F2b amendment note) — except this one section, which is dropped rather than carried over. `runCapture.ts` never proposes a value stream or stage, and this ADR's opening sentence in this bullet is why: capture is exactly the LLM-adjacent, probabilistic-extraction path this gate exists to keep out of the structural layer, and the fact that F2-lite's own deterministic JSON section didn't route through capture was never a reason to let it bypass the gate's *spirit* — it was a gap this sprint closes by removing the section, not by exempting it. Value streams are edited only through the element pages from Sprint F2b onward, exactly as every other part of this ADR already requires.

`enables` edges being structural (rather than ordinary relationship data a `propose` change could re-map) was a deliberate choice, recorded here: the simpler rule wins, and a proposed change's *impact* on value streams still flows through the existing edges — a propose change can change which systems support a capability and see the effect on every stream that capability enables; it just can't re-draw the stream layer itself.

### Rollup — "worst enabling capability", "worst stage"

The shared rollup (`src/ui/capabilityMap/capabilityRollup.ts` + `src/db/modelHome.ts`'s `buildCapabilityTiles`) already produces, per capability, a tile tone from exposure and coverage and a worst-of `fitForPurpose`. Value streams add no new per-capability metric; they add two levels of worst-of over those same inputs, in a new pure module `src/ui/valueStreams/valueStreamRollup.ts`:

- **Tone severity order (recorded here — the one judgment call the rollup needs):** `warn` (a supporting system is retiring/retired with no planned replacement) > `neutral` (nothing recorded — the capability has no supporting system at all) > `info` (exposed, replacement planned) > `ok`. "Nothing recorded" ranks above "replacement planned" because a coverage gap is a worse fact about a stage than an exposure someone has already planned around — the same "never falsely calm" direction `computeExposureTone`'s own history records.
- **Stage tone** = the worst tone among the capabilities that enable it; `neutral` when nothing enables it (a stage with no enabling capability is itself a "nothing recorded" gap). **Stream tone** = the worst tone among its stages.
- **`fitForPurpose`** rolls up as its own worst-of field (stage: worst across enabling capabilities; stream: worst across stages) and is shown as text next to the tone, **never folded into the tone** — so "a stage's tone equals the worst of its enabling capabilities' tones" stays an exact property (P-34) with the director tile's own tone as the oracle, not a second, blended scale.

Enabling capabilities may be at any level (a stage is usually enabled by level-2/3 capabilities); `buildCapabilityTiles` is already generic over which capability rows it is handed, so the rollup calls it with the set of enabling capabilities rather than the level-1 set the director door passes — no new rollup logic, the same functions pointed at a different input set.

### Impact — one more hop

`src/db/changeSummary.ts`'s existing traversal (touched system → `supports` → affected capability) gains one hop: affected capability → `enables` → stage → parent stream, as `AffectedValueStream { stream, stages: [{ stage, viaCapabilities }] }`, computed by one shared pure function (`src/ui/valueStreams/impactTraversal.ts`) used in three places: the change page and Changes list ("Affected value streams" beside affected capabilities), the decision comparison row (`compareOptions.ts` — the streams reached from the decision's own capabilities at each option's projection, with their rollup tone there), and a new "Impact" section on the element page (a system or container: via its own `supports` edges; a capability: directly).

### Views

Four, all queries over the head plus layout (rule 2; nothing stores a diagram):

1. **Value streams page** (`/o/:org/m/:model/value-streams`, nav "Value streams" in the Model group): one row per active stream, stages left→right as tiles coloured by rollup tone (tone word as text too — UI-principles §8.7), inactive streams collapsed; tapping a stage opens the shared Inspector with its enabling capabilities and their supporting systems, plus "Start a decision" (`decisionPrefill.ts`). Reads at the selected ref through `resolveBranchModeProjectionCached`, like Landscape. Mobile (< 768px): streams as a list, stages as rows.
2. **Director door**: a "By capability / By outcome" toggle (the `HomeModeSwitch` control shape; plain component state, not a `user_preferences` column) showing the value-stream rows in place of the capability tiles.
3. **Roadmap**: `?groupBy=capability|valueStream` — a system groups under every stream reachable from its primary `supports` capability's `enables` edges (so one system can appear in two streams), `Unassigned` when none.
4. **Capability map tile**: "enables N stages" (silent at zero). **Capability page**: an "Enables" group listing stages as "Stream › Stage" with links — the outbound relationship group that `RELATIONSHIP_TYPE_RULES` already produces for the new row, not a bespoke section.

### Editing

Search-first add for streams and stages (`ElementSearchAdd`/`HomeSearch`, a stage asking "which stream?" the way a module asks "which platform?"); reorder via the capability reorder control generalised to any ordered sibling set (`useCapabilityReorder` → `useSiblingReorder`, `ReorderButtons` lifted out of `CapabilityMapView.tsx`); the `enables` picker on a stage restricted to capabilities (automatic from the rules row); every write an ordinary commit through `commitToBranch` on the selected ref, gated as above.

### Starter content and import

- `content/capability-maps/<sector>/<version>.json` gains an optional `valueStreams` section: `[{ code, name, description?, order, stages: [{ code, name, description?, order, enables: [capability name] }] }]`. `enables` names capabilities **by name** (the brief's own wording — a content author thinks in names); the loader resolves each to the item's `code` and refuses the file on zero or ambiguous matches. Stored in two new tables, `capability_map_value_stream_items` and `capability_map_value_stream_enables` (SPEC §3.10), with the same immutability guard `capability_map_items` has once a map is published. Not overloaded onto `capability_map_items` — its `level 1–3`/`parent_code` trigger and every reader of it assume capabilities.
- `atlas.seed_from_map` gains `p_relationships_head` so a `template_seed` commit can carry the `enables` edges alongside the stream and stage `element.create`s (C22 is satisfied within the commit: stages are created before edges reference them). Export (`buildCapabilityMapExport`, `atlas.export_capability_map_as_draft`) round-trips value streams back out. Each sector map gains a new version carrying its streams: electricity_network (SPEN's eight), both local-government maps (Apply for a service, Report a problem, Pay the council, Get support), the rest minimal.
- The JSON import's schema gains `value_streams: [{ name, stages: [{ name, enables: [capability names] }] }]`; reconciliation matches streams and stages by name like everything else, creates what's missing and adds missing `enables` edges, and — like the existing relationship rows — never retracts anything.

## Alternatives rejected

- *A separate `stage` element type.* Doubles every exhaustive `Record<ElementType, …>` map, glyph, breadcrumb case and rules row for one containment fact; the "Platforms and modules" amendment already established that a new *meaning* layered onto `parentId` (a container that is a module) needs no new type. A stream and a stage differ only in whether `parentId` is null.
- *`enables` as a list attribute on the stage (`enabledBy: UUID[]`).* Loses per-edge provenance (ADR-007: "no fact without provenance" — each link is a fact someone recorded from some source), per-edge retract/restore, and the C9-style referential check a relationship gets for free.
- *A `value_stream_stages` table or a `stage_order` column.* Containment is `parentId` everywhere else in this taxonomy (ADR-001's Alternatives rejected: "contains" as a generic mechanism loses single-parent/acyclic guarantees), and `order` already exists for exactly this purpose on capabilities.
- *Engine-enforced intent gate (a C-invariant reading `branches.intent`).* The engine never reads intent (F0), and `atlas.commit_deltas` has no intent parameter; teaching it one would make a workflow concept a data-integrity concept. The gate stays where every other affordance gate lives.
- *`enables` as ordinary (non-structural) relationship data.* Considered — it would let a `propose` change re-map a stage. Rejected for the simpler rule: the stream layer, edges included, is what stays stable; what a proposal changes is the systems beneath it.
- *Folding `fitForPurpose` into the rollup tone.* Would make the stage tone a blended scale with no single oracle; kept separate so P-34 is exact.
- *Extending `attribute_definitions.applies_to` to `value_stream`.* Out of scope; the DB `CHECK` at `20260914020000_attribute_definitions.sql` stays as-is. Recorded in SPEC §11 so a later request is picking up a known gap.

## Consequences

Touch points, so the cost is visible up front (ADR-001: adding a type is expensive on purpose):

- **Contract/engine/DB (Step 2, one PR — rule 1):** `ELEMENT_TYPES`/`RELATIONSHIP_TYPES`, `ValueStreamAttributes`/`EnablesAttributes`, `ATTRIBUTE_SCHEMA_BY_TYPE`, `RELATIONSHIP_ATTRIBUTE_SCHEMA_BY_TYPE`, `RELATIONSHIP_TYPE_RULES`, C22 in `deltas.ts`; migration widening the `element_type` and `relationship_type` enums (`deltas.element_type` is already `text` since S1 item 18), the two map tables, and `seed_from_map`'s new parameter; round-trip tests RT-14/RT-15 and the P-8 generator; every exhaustive map TypeScript flags (glyph, export sheet labels, browse filter, home-search types, breadcrumb, relationship verbs/labels/removal effects, `describeEnvelope`).
- **Rollup and impact (Step 3):** `valueStreamRollup.ts` (P-34), `impactTraversal.ts`, `changeSummary.ts`, `compareOptions.ts`; `CapabilityTileData` surfaces the `fitForPurpose` the rollup already computes.
- **Views, editing, content, import, tests (Steps 4–9):** as listed above; `docs/SPRINT-F6-STATUS.md` at close.

Docs amended alongside this ADR: ADR-001 (an `Amended (F6)` paragraph: five element types, six relationship types once `replaces` — ADR-001's own amendment merged the same day, PR #257 — is counted, the non-type clarification), ADR-000's index, SPEC §3.1/§3.3/§3.10/§4/§5.2/§10/§11, the prompt pack's F6 entry, and `DELIBERATELY_NOT_MODELLED`'s doc comment.

**Deferred, unscheduled — not part of this sprint's own plan:**
- Custom attributes (`attribute_definitions`) on value streams — see Alternatives rejected.
- A per-stage owner or timing of any kind — explicitly *not* a gap: the brief rules them out, and adding either would make this the process model ADR-001 excludes.
- Value-stream rows on the capability-scoped Landscape and the Context view — no view of either asks for streams today.
