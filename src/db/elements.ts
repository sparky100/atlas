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
import type { UUID } from '../contracts/delta';
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
 * Batch lookup so a page with N badges makes one query, not N (§4.9's paint
 * budget). `assertInFilterSize` already keeps `elementIds` at or under 50,
 * so this never actually pages — routed through `selectAll` anyway for the
 * same reason every other `elements_head`/`relationships_head`/`facts`/
 * `deltas`/`commits` read is (SPEC §6.7, and this module's own enforcement
 * test, `headTableReads.test.ts`, requires it of every one of them).
 */
export async function getElementsByIds(supabase: Client, commitId: UUID, elementIds: readonly UUID[]): Promise<Map<UUID, ElementsHeadRow>> {
  if (elementIds.length === 0) return new Map();
  assertInFilterSize('getElementsByIds', 'element_id', elementIds);
  const query = supabase.from('elements_head').select(ELEMENTS_HEAD_COLUMNS, { count: 'exact' }).eq('commit_id', commitId).in('element_id', elementIds).order('element_id');
  const rows = await selectAll<ElementsHeadRow>(query);
  return new Map(rows.map((row) => [row.element_id, row]));
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

/**
 * Batched form of `listInFlightBranchesTouchingSubject` for the change
 * page's "other open changes touching the same elements" (Sprint C1 step
 * 6, UI-principles' change page spec) — a change branch typically touches
 * several subjects at once, and this is one round trip per table rather
 * than N. `excludeBranchId` drops the change's own branch from the
 * result — it always touches its own subjects, which isn't "another" open
 * change.
 */
export async function listInFlightBranchesTouchingSubjects(supabase: Client, modelId: UUID, subjectIds: readonly UUID[], excludeBranchId: UUID): Promise<BranchRow[]> {
  if (subjectIds.length === 0) return [];
  assertInFilterSize('listInFlightBranchesTouchingSubjects', 'subject_id', subjectIds);
  // Same selectAll/order-by-primary-key treatment as listInFlightBranchesTouchingSubject above.
  const deltasQuery = supabase.from('deltas').select('commit_id', { count: 'exact' }).eq('model_id', modelId).in('subject_id', subjectIds).order('id');
  const deltaRows = await selectAll<{ commit_id: UUID }>(deltasQuery);
  const commitIds = [...new Set(deltaRows.map((row) => row.commit_id))];
  if (commitIds.length === 0) return [];

  assertInFilterSize('listInFlightBranchesTouchingSubjects', 'id (commits)', commitIds);
  const commitsQuery = supabase.from('commits').select('branch_id', { count: 'exact' }).in('id', commitIds).order('id');
  const commitRows = await selectAll<{ branch_id: UUID }>(commitsQuery);
  const branchIds = [...new Set(commitRows.map((row) => row.branch_id))].filter((id) => id !== excludeBranchId);
  if (branchIds.length === 0) return [];

  assertInFilterSize('listInFlightBranchesTouchingSubjects', 'id (branches)', branchIds);
  const { data: branchRows, error: branchError } = await supabase
    .from('branches')
    .select('*')
    .in('id', branchIds)
    .neq('kind', 'main')
    .in('status', ['draft', 'proposed', 'in_review', 'approved']);
  if (branchError) throw new Error(`listInFlightBranchesTouchingSubjects: ${branchError.message}`);
  return branchRows as BranchRow[];
}
