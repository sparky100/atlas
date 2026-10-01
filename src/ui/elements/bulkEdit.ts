/**
 * F12 step 1: saving the Elements grid's edits — one commit, one
 * `element.update` delta per changed cell, all under the editor's own
 * manual source at confidence 1 (the same provenance the element page's
 * own edit form gives, `useElementEditor.ts`). The delta building itself is
 * `src/engine/bulkEdit.ts`; this only loads the facts it needs and writes
 * the commit.
 */
import type { AttributeFieldSchema } from '../../contracts/attributeSchema';
import type { CommitEnvelope, UUID } from '../../contracts/delta';
import type { ElementsHeadRow } from '../../contracts/rows';
import { loadAttributeFactsAtBranch } from '../../db/branchFacts';
import type { Client } from '../../db/client';
import { commitToBranch, type CommitResult } from '../../db/commits';
import { getOrCreateManualSource } from '../../db/sources';
import type { BranchRow } from '../../db/types';
import { buildBulkEditDeltas, type BulkEditCell } from '../../engine/bulkEdit';
import { describeEnvelope } from '../../engine/describeEnvelope';

export interface CommitBulkEditInput {
  modelId: UUID;
  orgId: UUID;
  userId: UUID;
  branch: BranchRow;
  expectedHeadCommitId: UUID;
  cells: readonly BulkEditCell[];
  elementsById: ReadonlyMap<UUID, ElementsHeadRow>;
  customFields: ReadonlyMap<string, { field: AttributeFieldSchema; appliesTo: readonly string[] }>;
}

export type CommitBulkEditResult =
  | CommitResult
  /** Nothing differed from the current values — no commit was written. */
  | { ok: true; commitId: null; newHead: null }
  | { ok: false; reason: 'validation'; errors: Map<string, string> };

export async function commitBulkEdit(supabase: Client, input: CommitBulkEditInput): Promise<CommitBulkEditResult> {
  const { modelId, orgId, userId, branch, expectedHeadCommitId, cells, elementsById, customFields } = input;
  if (cells.length === 0) return { ok: true, commitId: null, newHead: null };

  const factsByElement = await loadAttributeFactsAtBranch(supabase, modelId, branch, cells.map((cell) => cell.key));
  const source = await getOrCreateManualSource(supabase, { id: crypto.randomUUID(), orgId, modelId, userId });
  const built = buildBulkEditDeltas({ cells, elementsById, factsByElement, customFields, sourceId: source.id, newId: () => crypto.randomUUID() });
  if (!built.ok) return { ok: false, reason: 'validation', errors: built.errors };
  if (built.deltas.length === 0) return { ok: true, commitId: null, newHead: null };

  const elementCount = new Set(built.deltas.map((delta) => ('elementId' in delta ? delta.elementId : null))).size;
  const envelope: CommitEnvelope = {
    id: crypto.randomUUID(),
    branchId: branch.id,
    parentCommitId: expectedHeadCommitId,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: describeEnvelope(built.deltas, (id) => elementsById.get(id)?.name),
    body: `Bulk edit: ${String(built.deltas.length)} ${built.deltas.length === 1 ? 'value' : 'values'} across ${String(elementCount)} ${elementCount === 1 ? 'element' : 'elements'}`,
    deltas: built.deltas,
  };
  return commitToBranch(supabase, { modelId, branchId: branch.id, expectedHeadCommitId, envelope });
}
