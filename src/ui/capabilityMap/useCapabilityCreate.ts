import { useCallback, useState } from 'react';
import type { CommitEnvelope, Delta, UUID } from '../../contracts/delta';
import { commitToBranch } from '../../db/commits';
import { describeEnvelope } from '../../engine/describeEnvelope';
import { getOrCreateManualSource } from '../../db/sources';
import type { BranchRow } from '../../db/types';
import { supabase } from '../supabaseClient';

export type CapabilityCreateStatus = 'idle' | 'creating';

export interface UseCapabilityCreateResult {
  status: CapabilityCreateStatus;
  error: string | null;
  /** `parentId: null` creates a top-level (level 1) capability. */
  create: (name: string, parentId: UUID | null) => Promise<void>;
}

export interface UseCapabilityCreateInput {
  modelId: UUID;
  orgId: UUID;
  userId: UUID | null;
  /** Which branch this create commits to — see src/ui/elements/useElementEditor.ts's `branch` doc comment (Sprint C1). */
  branch: BranchRow;
  expectedHeadCommitId: UUID;
  onCreated: () => void;
}

/**
 * The tailoring flow's "add" action (Sprint U2 step 2, generalised beyond
 * main-only in Sprint C1): one `element.create` capability delta,
 * restricted — by this hook's own signature, not just by the form calling
 * it — to picking an *existing* capability (or none, for a new top level)
 * as parent. No `code`/`templateRef` on a hand-added capability: those are
 * starter-map provenance (src/contracts/delta.ts's `CapabilityAttributes`
 * doc comment), and a capability added this way was never seeded from one.
 */
export function useCapabilityCreate(input: UseCapabilityCreateInput): UseCapabilityCreateResult {
  const { modelId, orgId, userId, branch, expectedHeadCommitId, onCreated } = input;
  const [status, setStatus] = useState<CapabilityCreateStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const create = useCallback(
    async (name: string, parentId: UUID | null) => {
      if (!userId) {
        setError('You must be signed in to add a capability.');
        return;
      }
      const trimmed = name.trim();
      if (trimmed.length === 0) {
        setError('Name cannot be empty.');
        return;
      }
      setError(null);
      setStatus('creating');

      try {
        const source = await getOrCreateManualSource(supabase, { id: crypto.randomUUID(), orgId, modelId, userId });

        const delta: Delta = {
          kind: 'element.create',
          id: crypto.randomUUID(),
          elementId: crypto.randomUUID(),
          elementType: 'capability',
          name: trimmed,
          parentId,
          attributes: {},
          sourceId: source.id,
          confidence: 1,
        };

        const deltas = [delta];
        const envelope: CommitEnvelope = {
          id: crypto.randomUUID(),
          branchId: branch.id,
          parentCommitId: expectedHeadCommitId,
          mergedBranchHeadCommitId: null,
          kind: 'manual',
          // See useElementCreate.ts's identical comment: an element.create
          // delta never needs the name lookup, its name is on the delta.
          title: describeEnvelope(deltas, () => undefined),
          body: `Add capability "${trimmed}"`,
          deltas,
        };

        const result = await commitToBranch(supabase, { modelId, branchId: branch.id, expectedHeadCommitId, envelope });
        if (!result.ok) {
          setStatus('idle');
          setError(
            result.reason === 'conflict'
              ? 'The capability map changed since you loaded it. Reload the page and try again.'
              : `Could not add: ${result.message}`,
          );
          return;
        }

        setStatus('idle');
        onCreated();
      } catch (e) {
        setStatus('idle');
        setError(e instanceof Error ? e.message : 'Could not add capability.');
      }
    },
    [modelId, orgId, userId, branch, expectedHeadCommitId, onCreated],
  );

  return { status, error, create };
}
