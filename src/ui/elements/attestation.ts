/**
 * ADR-025 (F12 step 3): writing "Still accurate" for one element — its
 * current facts at the branch, re-asserted under a fresh `attestation`
 * source, as one commit. The delta building is `src/engine/attestation.ts`.
 */
import { EXISTS_ATTRIBUTE, type CommitEnvelope, type UUID } from '../../contracts/delta';
import type { ElementsHeadRow } from '../../contracts/rows';
import { loadFactsForSubjectAtBranch } from '../../db/branchFacts';
import type { Client } from '../../db/client';
import { commitToBranch, type CommitResult } from '../../db/commits';
import { createAttestationSource } from '../../db/sources';
import type { BranchRow } from '../../db/types';
import { buildAttestationDeltas } from '../../engine/attestation';

export interface CommitAttestationInput {
  modelId: UUID;
  orgId: UUID;
  userId: UUID;
  branch: BranchRow;
  expectedHeadCommitId: UUID;
  element: ElementsHeadRow;
  /** Today's date (`YYYY-MM-DD`), passed in so nothing here reads a clock. */
  today: string;
}

export async function commitAttestation(supabase: Client, input: CommitAttestationInput): Promise<CommitResult | { ok: false; reason: 'empty'; message: string }> {
  const { modelId, orgId, userId, branch, expectedHeadCommitId, element, today } = input;
  const facts = await loadFactsForSubjectAtBranch(supabase, modelId, branch, 'element', element.element_id);
  // Checked before a source is created, so an empty confirmation leaves no orphan source behind.
  if (![...facts.keys()].some((key) => key !== EXISTS_ATTRIBUTE)) return { ok: false, reason: 'empty', message: 'Nothing recorded on this element to confirm.' };
  const source = await createAttestationSource(supabase, { id: crypto.randomUUID(), orgId, modelId, createdBy: userId, elementName: element.name, confirmedOn: today });
  const deltas = buildAttestationDeltas({ element, facts, sourceId: source.id, newId: () => crypto.randomUUID() });
  const envelope: CommitEnvelope = {
    id: crypto.randomUUID(),
    branchId: branch.id,
    parentCommitId: expectedHeadCommitId,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title: `Confirmed ${element.name} still accurate`,
    body: `${String(deltas.length)} ${deltas.length === 1 ? 'value' : 'values'} re-asserted as still accurate`,
    deltas,
  };
  return commitToBranch(supabase, { modelId, branchId: branch.id, expectedHeadCommitId, envelope });
}
