import { useCallback, useState } from 'react';
import type { CommitEnvelope, Delta, RelationshipType, UUID } from '../../contracts/delta';
import { commitToBranch } from '../../db/commits';
import { getOrCreateManualSource } from '../../db/sources';
import type { BranchRow } from '../../db/types';
import { supabase } from '../supabaseClient';

export type RelationshipCreateStatus = 'idle' | 'creating';

export interface UseRelationshipCreateResult {
  status: RelationshipCreateStatus;
  error: string | null;
  create: (otherElementId: UUID) => Promise<void>;
}

export interface UseRelationshipCreateInput {
  modelId: UUID;
  orgId: UUID;
  userId: UUID | null;
  relationshipType: RelationshipType;
  direction: 'outbound' | 'inbound';
  /** The element whose Relationships section this "+ Add" lives on. */
  elementId: UUID;
  branch: BranchRow;
  expectedHeadCommitId: UUID;
  onCreated: () => void;
}

/**
 * Blocking: element creation's relationship-add control ("A '+ Add' under
 * each relationship-type group... creates a relationship.create delta via
 * commit_deltas with the user's manual source"). `direction` decides which
 * side `elementId` is on: outbound puts it at `fromElementId` (the group's
 * own label, e.g. "uses", already says this element is the subject);
 * inbound puts it at `toElementId` (e.g. "used by").
 *
 * `owns.primary` is the one relationship attribute type that's required
 * (`OwnsAttributes`, src/contracts/delta.ts) — defaulted to `true` here:
 * adding an owner through this control is naming *the* owner, not a
 * secondary one, and `maxPrimaryPerTo: 1` (relationship_type_rules) is
 * enforced server-side regardless of what this default guesses.
 */
export function useRelationshipCreate(input: UseRelationshipCreateInput): UseRelationshipCreateResult {
  const { modelId, orgId, userId, relationshipType, direction, elementId, branch, expectedHeadCommitId, onCreated } = input;
  const [status, setStatus] = useState<RelationshipCreateStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const create = useCallback(
    async (otherElementId: UUID) => {
      if (!userId) {
        setError('You must be signed in to add a relationship.');
        return;
      }
      setError(null);
      setStatus('creating');

      try {
        const source = await getOrCreateManualSource(supabase, { id: crypto.randomUUID(), orgId, modelId, userId });
        const fromElementId = direction === 'outbound' ? elementId : otherElementId;
        const toElementId = direction === 'outbound' ? otherElementId : elementId;

        // See this hook's own module comment for why `owns` alone gets a
        // real default here rather than `{}` — every other relationship
        // type's attributes are entirely optional (SupportsAttributes/
        // UsesAttributes/FlowsToAttributes).
        const attributes = relationshipType === 'owns' ? { primary: true } : {};

        const delta = {
          kind: 'relationship.create',
          id: crypto.randomUUID(),
          relationshipId: crypto.randomUUID(),
          relationshipType,
          fromElementId,
          toElementId,
          attributes,
          sourceId: source.id,
          confidence: 1,
        } as Delta;

        const envelope: CommitEnvelope = {
          id: crypto.randomUUID(),
          branchId: branch.id,
          parentCommitId: expectedHeadCommitId,
          mergedBranchHeadCommitId: null,
          kind: 'manual',
          message: `Add ${relationshipType} relationship`,
          deltas: [delta],
        };

        const result = await commitToBranch(supabase, { modelId, branchId: branch.id, expectedHeadCommitId, envelope });
        if (!result.ok) {
          setStatus('idle');
          setError(
            result.reason === 'conflict'
              ? 'The model changed since you loaded it. Reload the page and try again.'
              : `Could not add: ${result.message}`,
          );
          return;
        }

        setStatus('idle');
        onCreated();
      } catch (e) {
        setStatus('idle');
        setError(e instanceof Error ? e.message : 'Could not add relationship.');
      }
    },
    [modelId, orgId, userId, relationshipType, direction, elementId, branch, expectedHeadCommitId, onCreated],
  );

  return { status, error, create };
}
