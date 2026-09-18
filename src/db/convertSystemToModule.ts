/**
 * "Convert to a module" (`src/engine/convertSystemToModule.ts`'s own module
 * comment) — an ordinary `manual` commit through `commitToBranch`, the same
 * "mechanically exactly the edit a person would make by hand, just atomic
 * and computed" stance `elementMerges.ts` takes for a merge. Once the
 * commit has actually succeeded, the old system's name is recorded as a
 * `name` alias of the new container (`createAlias`, `aliasType: 'name'`) so
 * it's still findable by that name — the same "old name found by search"
 * reason `record_element_merge` records one for a merge's loser, but here a
 * plain client insert is enough: unlike merge, nothing needs `merged_id`
 * (no stale-permalink redirect is offered for this operation) or a new
 * table (no v1 undo, `convertSystemToModule.ts`'s own doc comment).
 */
import type { CommitEnvelope, UUID } from '../contracts/delta';
import { buildCommitLoader } from './commitLoader';
import { createAlias } from './aliases';
import type { Client } from './client';
import { commitToBranch } from './commits';
import { foldFromGenesis } from '../engine/head';
import { buildConvertSystemToModuleDeltas } from '../engine/convertSystemToModule';

export interface ConvertSystemToModuleInput {
  modelId: UUID;
  orgId: UUID;
  branchId: UUID;
  expectedHeadCommitId: UUID;
  systemId: UUID;
  targetPlatformId: UUID;
  /** A real `sources` row id (`getOrCreateManualSource`), never the source *kind* string — same convention every other editing hook already uses. */
  sourceId: UUID;
  userId: UUID;
}

export type ConvertSystemToModuleResult =
  | { status: 'converted'; commitId: UUID; newContainerId: UUID; droppedAttributeKeys: string[]; relationshipCount: number }
  | { status: 'invalid'; message: string }
  | { status: 'conflict'; message: string };

/**
 * Converts `systemId` into a module of `targetPlatformId` on `branchId`.
 * `commitToBranch` validates and writes the retract-and-recreate commit
 * first (the same optimistic-concurrency/role checks any other edit gets);
 * only once that has actually succeeded is the alias recorded — never the
 * other way around, since there's nothing to alias if the commit itself was
 * refused. A failure to record the alias is surfaced, not swallowed: the
 * conversion is real either way (the commit already landed), but the old
 * name silently not being findable would be a real, if minor, regression a
 * caller needs to know about (same stance `elementMerges.ts`'s own
 * `record_element_merge` error handling takes).
 */
export async function convertSystemToModule(supabase: Client, input: ConvertSystemToModuleInput): Promise<ConvertSystemToModuleResult> {
  const { modelId, orgId, branchId, expectedHeadCommitId, systemId, targetPlatformId, sourceId, userId } = input;

  const loader = await buildCommitLoader(supabase, modelId);
  const head = foldFromGenesis(expectedHeadCommitId, loader);
  const systemName = head.elements.get(systemId)?.name ?? systemId;
  const platformName = head.elements.get(targetPlatformId)?.name ?? targetPlatformId;

  let built;
  try {
    built = buildConvertSystemToModuleDeltas(head, systemId, targetPlatformId, sourceId, () => crypto.randomUUID());
  } catch (e) {
    return { status: 'invalid', message: e instanceof Error ? e.message : 'Could not convert this system to a module.' };
  }

  const commitId = crypto.randomUUID();
  const envelope: CommitEnvelope = {
    id: commitId,
    branchId,
    parentCommitId: expectedHeadCommitId,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    // A domain-specific title, not describeEnvelope's generic phrasing —
    // same carve-out `elementMerges.ts`'s own "Merge into…" title takes.
    title: `Convert "${systemName}" to a module of "${platformName}"`,
    body: null,
    deltas: built.deltas,
  };

  const commitResult = await commitToBranch(supabase, { modelId, branchId, expectedHeadCommitId, envelope });
  if (!commitResult.ok) return { status: commitResult.reason, message: commitResult.message };

  await createAlias(supabase, {
    id: crypto.randomUUID(),
    orgId,
    modelId,
    elementId: built.newContainerId,
    aliasValue: systemName,
    aliasType: 'name',
    sourceId,
    createdBy: userId,
  }).catch((e: unknown) => {
    throw new Error(`convertSystemToModule: the conversion commit succeeded but recording the old name as an alias failed: ${e instanceof Error ? e.message : String(e)}`);
  });

  return { status: 'converted', commitId: commitResult.commitId, newContainerId: built.newContainerId, droppedAttributeKeys: built.droppedAttributeKeys, relationshipCount: built.relationships.length };
}
