import { useCallback, useState } from 'react';
import type { CommitEnvelope, Delta, UUID } from '../../contracts/delta';
import { getMainBranch } from '../../db/branches';
import { commitToBranch } from '../../db/commits';
import { getOrCreateManualSource } from '../../db/sources';
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
  expectedHeadCommitId: UUID;
  onCreated: () => void;
}

/**
 * The tailoring flow's "add" action (Sprint U2 step 2): one
 * `element.create` capability delta, restricted — by this hook's own
 * signature, not just by the form calling it — to picking an *existing*
 * capability (or none, for a new top level) as parent. No `code`/
 * `templateRef` on a hand-added capability: those are starter-map
 * provenance (src/contracts/delta.ts's `CapabilityAttributes` doc comment),
 * and a capability added this way was never seeded from one.
 */
export function useCapabilityCreate(input: UseCapabilityCreateInput): UseCapabilityCreateResult {
  const { modelId, orgId, userId, expectedHeadCommitId, onCreated } = input;
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
        const main = await getMainBranch(supabase, modelId);
        if (!main?.head_commit_id) throw new Error('main branch has no commits yet');

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

        const envelope: CommitEnvelope = {
          id: crypto.randomUUID(),
          branchId: main.id,
          parentCommitId: expectedHeadCommitId,
          mergedBranchHeadCommitId: null,
          kind: 'manual',
          message: `Add capability "${trimmed}"`,
          authorId: userId,
          deltas: [delta],
        };

        const result = await commitToBranch(supabase, { modelId, branchId: main.id, expectedHeadCommitId, envelope });
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
    [modelId, orgId, userId, expectedHeadCommitId, onCreated],
  );

  return { status, error, create };
}
