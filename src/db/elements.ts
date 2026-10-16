/**
 * Read queries for the element page (UI-principles.md §4). All against the
 * materialised projections (`elements_head`/`relationships_head`/`facts`)
 * or `deltas`/`aliases` directly — nothing here computes a fold; that's
 * src/engine's job, and Sprint U1's element page only ever renders `main`
 * or a tag (both materialised, ADR-015), never a branch's arbitrary commit.
 *
 * Row shapes reuse src/contracts/rows.ts's `ElementsHeadRow`/
 * `RelationshipsHeadRow`/`FactsRow` — the same types
 * src/engine/projection.ts serialises *into* — so a read and a write agree
 * on the shape by construction, not by two hand-kept definitions.
 */
import type { ElementsHeadRow, FactsRow, RelationshipsHeadRow, DeltaRow } from '../contracts/rows';
import type { Json, UUID } from '../contracts/delta';
import { sharedElements, touchedElementsByBranch, type DeltaTouchRow } from '../engine/changeOverlap';
import { attributesRecord } from '../ui/elements/attributesRecord';
import type { Client } from './client';
import { assertInFilterSize } from './inFilterLimit';
import { selectAll } from './selectAll';
import type { AliasRow, BranchRow, SourceRow } from './types';

const ELEMENTS_HEAD_COLUMNS = 'element_id, element_type, name, parent_id, attributes, exists_delta_id';
const RELATIONSHIPS_HEAD_COLUMNS = 'relationship_id, relationship_type, from_element_id, to_element_id, attributes, exists_delta_id';
const FACTS_COLUMNS = 'subject_type, subject_id, attribute, value, delta_id, source_id, source_ref, effective_date, confidence, asserted_by, asserted_at';

/**
 * `DeltaRow` (src/contracts/rows.ts) is the wire↔storage mapping for
 * *writing* a delta — it deliberately has no `created_at` (DB-assigned,
 * never client-supplied). Reading `deltas` for display needs that
 * timestamp, so this read-only path gets its own row shape rather than
 * silently widening the write-oriented contract type.
 */
export type DeltaHistoryRow = DeltaRow & { created_at: string };

export async function getElementHead(supabase: Client, commitId: UUID, elementId: UUID): Promise<ElementsHeadRow | null> {
   
  const { data, error } = await supabase.from('elements_head').select(ELEMENTS_HEAD_COLUMNS).eq('commit_id', commitId).eq('element_id', elementId).maybeSingle();
  if (error) throw new Error(`getElementHead: ${error.message}`);
  return data;
}

/** Routed through `selectAll` (SPEC §6.7); ordered by `element_id` in addition to `name` for a stable, unique pagination order (see `listSystemsForLandscape`'s identical comment, src/db/landscape.ts). */
export async function listChildrenOf(supabase: Client, commitId: UUID, parentId: UUID): Promise<ElementsHeadRow[]> {
  const query = supabase.from('elements_head').select(ELEMENTS_HEAD_COLUMNS, { count: 'exact' }).eq('commit_id', commitId).eq('parent_id', parentId).order('name').order('element_id');
  return selectAll<ElementsHeadRow>(query);
}

/** Routed through `selectAll` (SPEC §6.7); ordered by `attribute` — `(commit_id, subject_id, attribute)` is `facts`'s primary key, and `commit_id`/`subject_id` are already pinned by the `.eq()`s above, so this is a unique pagination order. */
export async function listFactsForSubject(supabase: Client, commitId: UUID, subjectId: UUID): Promise<FactsRow[]> {
  const query = supabase.from('facts').select(FACTS_COLUMNS, { count: 'exact' }).eq('commit_id', commitId).eq('subject_id', subjectId).order('attribute');
  return selectAll<FactsRow>(query);
}

/**
 * Every live `attribute` fact at `commitId`, across every subject — the
 * commit/model-scoped shape CLAUDE.md rule 8 asks for instead of an
 * `.in(subject_id, [...])` sized by however many subjects a caller cares
 * about (a list that can grow with the model, e.g. "every capability"):
 * one query bounded by `commit_id`/`attribute` alone, filtered against the
 * caller's own subject list client-side (src/db/syncDescriptionsFromMap.ts's
 * one caller today). Ordered by `subject_id` for a stable pagination order —
 * `(commit_id, subject_id, attribute)` is `facts`'s primary key, and
 * `commit_id`/`attribute` are already pinned by the `.eq()`s above.
 */
export async function listFactsForAttribute(supabase: Client, commitId: UUID, attribute: string): Promise<FactsRow[]> {
  const query = supabase.from('facts').select(FACTS_COLUMNS, { count: 'exact' }).eq('commit_id', commitId).eq('attribute', attribute).order('subject_id');
  return selectAll<FactsRow>(query);
}

/**
 * Every relationship touching `elementId` in either direction — §4.4's "both
 * directions are shown," never just outbound. Routed through `selectAll`
 * (SPEC §6.7), ordered by `relationship_id` for a stable, unique pagination
 * order.
 */
export async function listRelationshipsForElement(supabase: Client, commitId: UUID, elementId: UUID): Promise<RelationshipsHeadRow[]> {
  const query = supabase
    .from('relationships_head')
    .select(RELATIONSHIPS_HEAD_COLUMNS, { count: 'exact' })
    .eq('commit_id', commitId)
    .or(`from_element_id.eq.${elementId},to_element_id.eq.${elementId}`)
    .order('relationship_id');
  return selectAll<RelationshipsHeadRow>(query);
}

/**
 * Every `uses`/`flows_to` edge whose `via` names `platformElementId` —
 * Prompt 7k item 4's "Flows via this platform" element-page section.
 * `attributes ->> 'via'` can't be pushed into a `.eq()` alongside the
 * `relationship_type` filter without a raw-jsonb postgrest operator this
 * codebase has no other precedent for, so this queries the commit's whole
 * `uses`/`flows_to` scope (bounded by the model, not by how many flows
 * happen to have a `via` — CLAUDE.md rule 8's own reference shape) and
 * filters to `via` client-side, the same "query the scope once" pattern
 * `listRelationshipsForElement` above already gives a real precedent for.
 */
export async function listFlowsViaElement(supabase: Client, commitId: UUID, viaIds: readonly UUID[]): Promise<RelationshipsHeadRow[]> {
  const query = supabase
    .from('relationships_head')
    .select(RELATIONSHIPS_HEAD_COLUMNS, { count: 'exact' })
    .eq('commit_id', commitId)
    .in('relationship_type', ['uses', 'flows_to'])
    .order('relationship_id');
  const rows = await selectAll<RelationshipsHeadRow>(query);
  // ADR-026: `viaIds` is a platform plus its interfaces (a platform's own page and Context view), or one interface alone.
  const wanted = new Set(viaIds);
  return rows.filter((row) => {
    const via = attributesRecord(row.attributes).via;
    return typeof via === 'string' && wanted.has(via);
  });
}

/**
 * Batch lookup so a page with N badges makes one query, not N (§4.9's paint
 * budget). Used to put `elementIds` straight into `.in('element_id', ...)`,
 * guarded by `assertInFilterSize` — real, live 400 on dev, 2026-09-10: the
 * architect door's own health-findings/duplicates rollup calls this with
 * every capability in the model, and a starter-map-seeded model clears 50
 * on its own (an NHS import alone is 73). CLAUDE.md rule 8's own fix for
 * exactly this shape (a caller-supplied id list that grows with the model,
 * not a small fixed enum): query the commit scope alone —
 * `.eq('commit_id', commitId)`, no `.in()` at all — and filter to
 * `elementIds` client-side, the same rewrite `src/db/landscape.ts`'s
 * `listLandscapeEdges`/`listSupportsEdgesForSystems` already did for the
 * identical reason (their own comments cite the same rule). Still routed
 * through `selectAll` (SPEC §6.7, and this module's own enforcement test,
 * `headTableReads.test.ts`) since the *unfiltered* commit scope is exactly
 * the kind of read that can now genuinely page.
 */
export async function getElementsByIds(supabase: Client, commitId: UUID, elementIds: readonly UUID[]): Promise<Map<UUID, ElementsHeadRow>> {
  if (elementIds.length === 0) return new Map();
  const wanted = new Set(elementIds);
  const query = supabase.from('elements_head').select(ELEMENTS_HEAD_COLUMNS, { count: 'exact' }).eq('commit_id', commitId).order('element_id');
  const rows = await selectAll<ElementsHeadRow>(query);
  const result = new Map<UUID, ElementsHeadRow>();
  for (const row of rows) {
    if (wanted.has(row.element_id)) result.set(row.element_id, row);
  }
  return result;
}

/**
 * A possibly-retracted element's own name, recovered from `deltas` rather
 * than `elements_head` — `HistoryTimeline.tsx`'s own fallback for a
 * relationship whose other endpoint has itself since been retracted (so
 * `getElementsByIds`, scoped to *live* elements at a commit, has nothing
 * to return): `deltas` never deletes a row (CLAUDE.md rule 5), so the
 * element's own `element_create` row — and any later rename, a
 * `element_update` with `attribute: 'name'` (`useElementRename.ts`) —
 * are both still there regardless of the element's current existence.
 * Takes the latest of the two per id, so a renamed-then-retracted element
 * still shows its last real name, not the one it was created with. A
 * name-less result (should not happen — `name` is required at creation)
 * is simply omitted, same "don't fabricate" spirit `getElementsByIds`
 * already follows for an id with no row at all.
 *
 * Bounded the same way `listRelationshipHistoryForElement`'s own fan-out
 * already is documented to be — one element's own relationship-history
 * endpoints, not a list that grows with model size — so a real `.in()`
 * (`getSourcesByIds`'s own identical shape) is the right call here, not
 * the unfiltered-then-client-filter shape `getElementsByIds` uses for a
 * genuinely commit-sized scan.
 */
export async function getElementNamesByIds(supabase: Client, modelId: UUID, elementIds: readonly UUID[]): Promise<Map<UUID, string>> {
  if (elementIds.length === 0) return new Map();
  assertInFilterSize('getElementNamesByIds', 'subject_id', elementIds);
  // Routed through selectAll (SPEC §6.7: `deltas` is head-scoped, never a
  // plain unpaginated `.select()`) even though the `.in()` above already
  // bounds this to at most 50 ids — `headTableReads.test.ts` enforces the
  // same rule regardless of how small a particular caller's result is.
  // `subject_id` is a unique order within this query's own scope (at most
  // one `element_create` per element); `(created_at, id)` likewise for the
  // renames, `id` alone already being globally unique.
  // The inline generics below use `,` rather than `;` between fields —
  // `headTableReads.test.ts`'s own text-level scan (its module comment
  // says as much) treats any `;` as a statement boundary, and TypeScript
  // accepts either separator in an object type literal.
  const [created, renamed] = await Promise.all([
    selectAll<{ subject_id: UUID, name: string | null }>(
      supabase.from('deltas').select('subject_id, name', { count: 'exact' }).eq('model_id', modelId).eq('kind', 'element_create').in('subject_id', elementIds).order('subject_id'),
    ),
    selectAll<{ subject_id: UUID, value: Json | null }>(
      supabase
        .from('deltas')
        .select('subject_id, value, created_at, id', { count: 'exact' })
        .eq('model_id', modelId)
        .eq('kind', 'element_update')
        .eq('attribute', 'name')
        .in('subject_id', elementIds)
        .order('created_at')
        .order('id'),
    ),
  ]);
  const names = new Map<UUID, string>();
  for (const row of created) {
    if (row.name) names.set(row.subject_id, row.name);
  }
  // Oldest first (the query's own order) — the last rename applied per id, in this loop, is its latest.
  for (const row of renamed) {
    if (typeof row.value === 'string') names.set(row.subject_id, row.value);
  }
  return names;
}

export async function getSourcesByIds(supabase: Client, sourceIds: readonly UUID[]): Promise<Map<UUID, SourceRow>> {
  if (sourceIds.length === 0) return new Map();
  assertInFilterSize('getSourcesByIds', 'id', sourceIds);
  const { data, error } = await supabase.from('sources').select('*').in('id', sourceIds);
  if (error) throw new Error(`getSourcesByIds: ${error.message}`);
  const rows = data as SourceRow[];
  return new Map(rows.map((row) => [row.id, row]));
}

/** Aliases are model-scoped, not commit-scoped (SPEC §3.6) — a rename doesn't retract the old alias. */
export async function listAliasesForElement(supabase: Client, modelId: UUID, elementId: UUID): Promise<AliasRow[]> {
  const { data, error } = await supabase.from('aliases').select('*').eq('model_id', modelId).eq('element_id', elementId).neq('alias_type', 'merged_id');
  if (error) throw new Error(`listAliasesForElement: ${error.message}`);
  return data as AliasRow[];
}

/**
 * The full history of every delta ever asserted about `subjectId`, newest
 * first (§4.6.2's timeline) — this is the audit trail, read straight off
 * `deltas`, not a projection. Routed through `selectAll` (SPEC §6.7);
 * `created_at` alone isn't necessarily unique (two deltas in the same
 * commit can share a timestamp), so `id` (this table's actual primary key)
 * is added as a tiebreaker for a stable pagination order.
 */
export async function listDeltaHistoryForSubject(supabase: Client, modelId: UUID, subjectId: UUID): Promise<DeltaHistoryRow[]> {
  const query = supabase
    .from('deltas')
    .select('*', { count: 'exact' })
    .eq('model_id', modelId)
    .eq('subject_id', subjectId)
    .order('created_at', { ascending: false })
    .order('id');
  return selectAll<DeltaHistoryRow>(query);
}

/**
 * "Relationship removal"'s history gap: `listDeltaHistoryForSubject` above
 * is subject-generic (it works for a relationship's own id exactly as well
 * as an element's), but nothing calls it with a relationship id anywhere —
 * a relationship's `subject_id` (`subjectOf()`/`factKeyOf()`,
 * `src/contracts/delta.ts`) is its own `relationshipId`, distinct from
 * either endpoint's element id, so an element's own history query never
 * surfaces it. This closes that gap: find every `relationship.create`
 * delta naming `elementId` on either side (the `.or()` both-directions
 * shape `listRelationshipsForElement` above already establishes for this
 * exact case), then pull each discovered relationship's own full history.
 *
 * Bounded by how many relationships have ever touched this one element —
 * the same order as `relationships.length` on the element page today, not
 * by model size — so this is a plain small-N fan-out, not a
 * caller-scoped `.in()` (CLAUDE.md rule 8 doesn't apply here).
 * Model-scoped, not commit-scoped, same as `listDeltaHistoryForSubject`
 * itself: a retracted relationship's own `relationship_create` row still
 * exists in `deltas` regardless of the current commit, which is exactly
 * the point — "history keeps the relationship and its provenance" even
 * after it's gone from `relationships_head`.
 */
export async function listRelationshipHistoryForElement(supabase: Client, modelId: UUID, elementId: UUID): Promise<DeltaHistoryRow[]> {
  const query = supabase
    .from('deltas')
    .select('subject_id', { count: 'exact' })
    .eq('model_id', modelId)
    .eq('kind', 'relationship_create')
    .or(`from_element_id.eq.${elementId},to_element_id.eq.${elementId}`)
    .order('id');
  const creates = await selectAll<{ subject_id: UUID }>(query);
  const relationshipIds = [...new Set(creates.map((row) => row.subject_id))];
  const perRelationship = await Promise.all(relationshipIds.map((id) => listDeltaHistoryForSubject(supabase, modelId, id)));
  return perRelationship.flat();
}

/** A single fact's supersession chain (§4.3's provenance card): follow `previous_delta_id` back from `deltaId` to genesis. Bounded by the chain's real length, not by history depth — a fact is superseded at most a handful of times in practice. */
export async function getSupersessionChain(supabase: Client, deltaId: UUID): Promise<DeltaRow[]> {
  const chain: DeltaRow[] = [];
  let currentId: UUID | null = deltaId;
  const seen = new Set<UUID>();
  while (currentId && !seen.has(currentId)) {
    seen.add(currentId);
    // Sequential by nature (each step needs the previous one's
    // previous_delta_id) — not a candidate for Promise.all.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
    const { data, error } = await supabase.from('deltas').select('*').eq('id', currentId).maybeSingle();
    if (error) throw new Error(`getSupersessionChain: ${error.message}`);
    const row = data as DeltaRow | null;
    if (!row) break;
    chain.push(row);
    currentId = row.previous_delta_id;
  }
  return chain;
}

/**
 * Branches with an in-flight status whose own deltas touch `subjectId`
 * (§4.6.1's "changes touching this," in-flight half). Sprint U1 has no
 * editing on change branches yet (ADR-015: only main is ever committed to
 * from the UI), so this is real and correct but reliably empty for
 * now — named here rather than skipped, since the query itself doesn't
 * depend on that changing.
 */
export async function listInFlightBranchesTouchingSubject(supabase: Client, modelId: UUID, subjectId: UUID): Promise<BranchRow[]> {
  // `deltas`/`commits` reads routed through `selectAll` (SPEC §6.7), ordered
  // by each table's own primary key (`id`) — not part of the selected
  // columns, but still a valid, unique ORDER BY target, and the only thing
  // that matters for these two is complete row coverage, not row order.
  const deltasQuery = supabase.from('deltas').select('commit_id', { count: 'exact' }).eq('model_id', modelId).eq('subject_id', subjectId).order('id');
  const deltaRows = await selectAll<{ commit_id: UUID }>(deltasQuery);
  const commitIds = [...new Set(deltaRows.map((row) => row.commit_id))];
  if (commitIds.length === 0) return [];

  assertInFilterSize('listInFlightBranchesTouchingSubject', 'id (commits)', commitIds);
  const commitsQuery = supabase.from('commits').select('branch_id', { count: 'exact' }).in('id', commitIds).order('id');
  const commitRows = await selectAll<{ branch_id: UUID }>(commitsQuery);
  const branchIds = [...new Set(commitRows.map((row) => row.branch_id))];
  if (branchIds.length === 0) return [];

  assertInFilterSize('listInFlightBranchesTouchingSubject', 'id (branches)', branchIds);
  const { data: branchRows, error: branchError } = await supabase
    .from('branches')
    .select('*')
    .in('id', branchIds)
    .neq('kind', 'main')
    .in('status', ['draft', 'proposed', 'in_review', 'approved']);
  if (branchError) throw new Error(`listInFlightBranchesTouchingSubject: ${branchError.message}`);
  return branchRows as BranchRow[];
}

/** Another open change and the elements it shares with the change being looked at (`sharedElements`, `src/engine/changeOverlap.ts`). */
export interface OverlappingChange {
  branch: BranchRow;
  sharedElementIds: UUID[];
}

/**
 * The change page's "other open changes touching the same elements"
 * (Sprint C1 step 6; widened by ADR-024 §9): every other open change that
 * touches an element this one does — an element edit, or either end of a
 * relationship edit — or a platform/module pair across the two
 * (`sharedElements`).
 *
 * Per SPEC §6.7/CLAUDE.md rule 8 no id list ever goes into an `.in()`
 * filter: each step reads the model scope alone (`deltas`/`commits`/
 * `branches` all carry `model_id`) and narrows in memory, the same shape as
 * `src/db/landscape.ts`'s `listLandscapeEdges`. `status` stays an `.in()`
 * filter — a fixed, small enum, never a growing id list. Every relationship
 * create delta in the model is read too, not just open changes' own: an
 * update or retract carries only the relationship id, and the relationship
 * may have been created on main. `ownTouched` is the change's own set, from
 * its own deltas (`listOwnDeltas`, so nothing a refresh brought in from main).
 */
export async function listOpenChangesSharingElements(supabase: Client, modelId: UUID, branchId: UUID, ownTouched: ReadonlySet<UUID>, parentOf: (elementId: UUID) => UUID | null): Promise<OverlappingChange[]> {
  const deltasQuery = supabase.from('deltas').select('commit_id, subject_type, subject_id, from_element_id, to_element_id', { count: 'exact' }).eq('model_id', modelId).order('id');
  const commitsQuery = supabase.from('commits').select('id, branch_id', { count: 'exact' }).eq('model_id', modelId).order('id');
  const [deltaRows, commitRows, branchResult] = await Promise.all([
    selectAll<{ commit_id: UUID; subject_type: 'element' | 'relationship'; subject_id: UUID; from_element_id: UUID | null; to_element_id: UUID | null }>(deltasQuery),
    selectAll<{ id: UUID; branch_id: UUID }>(commitsQuery),
    supabase.from('branches').select('*').eq('model_id', modelId).neq('kind', 'main').in('status', ['draft', 'proposed', 'in_review', 'approved']),
  ]);
  if (branchResult.error) throw new Error(`listOpenChangesSharingElements: ${branchResult.error.message}`);
  const openBranches = (branchResult.data as BranchRow[]).filter((b) => b.id !== branchId);
  const wanted = new Set(openBranches.map((b) => b.id));

  const branchByCommitId = new Map(commitRows.map((c) => [c.id, c.branch_id]));
  const relationshipEnds = new Map<UUID, { fromElementId: UUID; toElementId: UUID }>();
  const rows: DeltaTouchRow[] = [];
  for (const row of deltaRows) {
    if (row.subject_type === 'relationship' && row.from_element_id !== null && row.to_element_id !== null) {
      relationshipEnds.set(row.subject_id, { fromElementId: row.from_element_id, toElementId: row.to_element_id });
    }
    const rowBranchId = branchByCommitId.get(row.commit_id);
    if (rowBranchId !== undefined && wanted.has(rowBranchId)) rows.push({ branchId: rowBranchId, subjectType: row.subject_type, subjectId: row.subject_id });
  }

  const touched = touchedElementsByBranch(rows, relationshipEnds);
  const result: OverlappingChange[] = [];
  for (const branch of openBranches) {
    const sharedElementIds = sharedElements(ownTouched, touched.get(branch.id) ?? new Set<UUID>(), parentOf);
    if (sharedElementIds.length > 0) result.push({ branch, sharedElementIds });
  }
  return result.sort((a, b) => (a.branch.title ?? a.branch.name).localeCompare(b.branch.title ?? b.branch.name));
}
