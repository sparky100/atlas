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

export async function listChildrenOf(supabase: Client, commitId: UUID, parentId: UUID): Promise<ElementsHeadRow[]> {
  const { data, error } = await supabase.from('elements_head').select(ELEMENTS_HEAD_COLUMNS).eq('commit_id', commitId).eq('parent_id', parentId).order('name');
  if (error) throw new Error(`listChildrenOf: ${error.message}`);
  return data;
}

export async function listFactsForSubject(supabase: Client, commitId: UUID, subjectId: UUID): Promise<FactsRow[]> {
  const { data, error } = await supabase.from('facts').select(FACTS_COLUMNS).eq('commit_id', commitId).eq('subject_id', subjectId);
  if (error) throw new Error(`listFactsForSubject: ${error.message}`);
  return data;
}

/** Every relationship touching `elementId` in either direction — §4.4's "both directions are shown," never just outbound. */
export async function listRelationshipsForElement(supabase: Client, commitId: UUID, elementId: UUID): Promise<RelationshipsHeadRow[]> {
  const { data, error } = await supabase
    .from('relationships_head')
    .select(RELATIONSHIPS_HEAD_COLUMNS)
    .eq('commit_id', commitId)
    .or(`from_element_id.eq.${elementId},to_element_id.eq.${elementId}`);
  if (error) throw new Error(`listRelationshipsForElement: ${error.message}`);
  return data;
}

/** Batch lookup so a page with N badges makes one query, not N (§4.9's paint budget). */
export async function getElementsByIds(supabase: Client, commitId: UUID, elementIds: readonly UUID[]): Promise<Map<UUID, ElementsHeadRow>> {
  if (elementIds.length === 0) return new Map();
  const { data, error } = await supabase.from('elements_head').select(ELEMENTS_HEAD_COLUMNS).eq('commit_id', commitId).in('element_id', elementIds);
  if (error) throw new Error(`getElementsByIds: ${error.message}`);
  const rows = data as ElementsHeadRow[];
  return new Map(rows.map((row) => [row.element_id, row]));
}

export async function getSourcesByIds(supabase: Client, sourceIds: readonly UUID[]): Promise<Map<UUID, SourceRow>> {
  if (sourceIds.length === 0) return new Map();
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

/** The full history of every delta ever asserted about `subjectId`, newest first (§4.6.2's timeline) — this is the audit trail, read straight off `deltas`, not a projection. */
export async function listDeltaHistoryForSubject(supabase: Client, modelId: UUID, subjectId: UUID): Promise<DeltaHistoryRow[]> {
  const { data, error } = await supabase.from('deltas').select('*').eq('model_id', modelId).eq('subject_id', subjectId).order('created_at', { ascending: false });
  if (error) throw new Error(`listDeltaHistoryForSubject: ${error.message}`);
  return data as DeltaHistoryRow[];
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
  const { data: deltaRows, error: deltaError } = await supabase.from('deltas').select('commit_id').eq('model_id', modelId).eq('subject_id', subjectId);
  if (deltaError) throw new Error(`listInFlightBranchesTouchingSubject: ${deltaError.message}`);
  const commitIds = [...new Set((deltaRows as { commit_id: UUID }[]).map((row) => row.commit_id))];
  if (commitIds.length === 0) return [];

  const { data: commitRows, error: commitError } = await supabase.from('commits').select('branch_id').in('id', commitIds);
  if (commitError) throw new Error(`listInFlightBranchesTouchingSubject: ${commitError.message}`);
  const branchIds = [...new Set((commitRows as { branch_id: UUID }[]).map((row) => row.branch_id))];
  if (branchIds.length === 0) return [];

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
  const { data: deltaRows, error: deltaError } = await supabase.from('deltas').select('commit_id').eq('model_id', modelId).in('subject_id', subjectIds);
  if (deltaError) throw new Error(`listInFlightBranchesTouchingSubjects: ${deltaError.message}`);
  const commitIds = [...new Set((deltaRows as { commit_id: UUID }[]).map((row) => row.commit_id))];
  if (commitIds.length === 0) return [];

  const { data: commitRows, error: commitError } = await supabase.from('commits').select('branch_id').in('id', commitIds);
  if (commitError) throw new Error(`listInFlightBranchesTouchingSubjects: ${commitError.message}`);
  const branchIds = [...new Set((commitRows as { branch_id: UUID }[]).map((row) => row.branch_id))].filter((id) => id !== excludeBranchId);
  if (branchIds.length === 0) return [];

  const { data: branchRows, error: branchError } = await supabase
    .from('branches')
    .select('*')
    .in('id', branchIds)
    .neq('kind', 'main')
    .in('status', ['draft', 'proposed', 'in_review', 'approved']);
  if (branchError) throw new Error(`listInFlightBranchesTouchingSubjects: ${branchError.message}`);
  return branchRows as BranchRow[];
}
