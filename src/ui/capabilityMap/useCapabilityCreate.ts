import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import type { CommitEnvelope, Delta, UUID } from '../../contracts/delta';
import { getBranch, getMainBranch } from '../../db/branches';
import { commitToBranch } from '../../db/commits';
import { describeEnvelope } from '../../engine/describeEnvelope';
import { getOrCreateManualSource } from '../../db/sources';
import type { BranchRow } from '../../db/types';
import { applyCommitToCache } from '../query/applyCommitToCache';
import { supabase } from '../supabaseClient';
import { nextSiblingOrder, type CapabilityMapTree } from './layout';

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
  /** Read-only: `layout.ts`'s `nextSiblingOrder` uses this to give the new capability an `order` among its new siblings — the same tree `CapabilityMapAddForm.tsx`'s own parent picker is already built from, so no extra query. */
  tree: CapabilityMapTree;
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
 * `order` is different (Sprint U4-1 C1, tightened after review): every
 * capability gets one at creation, seeded or hand-added alike, so it can
 * be reordered immediately rather than staying permanently un-orderable —
 * one more than the highest existing sibling's order (`layout.ts`'s
 * `nextSiblingOrder`), landing the new capability last among its siblings.
 */
export function useCapabilityCreate(input: UseCapabilityCreateInput): UseCapabilityCreateResult {
  const { modelId, orgId, userId, branch, expectedHeadCommitId, tree, onCreated } = input;
  const [status, setStatus] = useState<CapabilityCreateStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

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
        // E8 item (1) fallout: see useElementCreate.ts's identical comment
        // on why a pure create resolves the branch's own current head
        // fresh, rather than trusting a possibly-stale cached prop.
        const currentBranch = branch.kind === 'main' ? await getMainBranch(supabase, modelId) : await getBranch(supabase, branch.id);
        const currentHeadCommitId = currentBranch?.head_commit_id ?? expectedHeadCommitId;

        const source = await getOrCreateManualSource(supabase, { id: crypto.randomUUID(), orgId, modelId, userId });

        const delta: Delta = {
          kind: 'element.create',
          id: crypto.randomUUID(),
          elementId: crypto.randomUUID(),
          elementType: 'capability',
          name: trimmed,
          parentId,
          attributes: { order: nextSiblingOrder(tree, parentId) },
          sourceId: source.id,
          confidence: 1,
        };

        const deltas = [delta];
        const envelope: CommitEnvelope = {
          id: crypto.randomUUID(),
          branchId: branch.id,
          parentCommitId: currentHeadCommitId,
          mergedBranchHeadCommitId: null,
          kind: 'manual',
          // See useElementCreate.ts's identical comment: an element.create
          // delta never needs the name lookup, its name is on the delta.
          title: describeEnvelope(deltas, () => undefined),
          body: `Add capability "${trimmed}"`,
          deltas,
        };

        const result = await commitToBranch(supabase, { modelId, branchId: branch.id, expectedHeadCommitId: currentHeadCommitId, envelope });
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
        // E8 item (3): seeds the cache with the head this commit already computed — see applyCommitToCache.ts's own comment.
        applyCommitToCache(queryClient, modelId, branch, result.commitId, result.newHead);
        onCreated();
      } catch (e) {
        setStatus('idle');
        setError(e instanceof Error ? e.message : 'Could not add capability.');
      }
    },
    [modelId, orgId, userId, branch, expectedHeadCommitId, tree, onCreated, queryClient],
  );

  return { status, error, create };
}
