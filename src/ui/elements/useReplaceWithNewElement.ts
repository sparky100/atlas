import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { validateAttributeValue } from '../../contracts/attributeSchema';
import type { ElementsHeadRow, FactsRow, RelationshipsHeadRow } from '../../contracts/rows';
import { commitToBranch } from '../../db/commits';
import { getOrCreateManualSource } from '../../db/sources';
import type { BranchRow } from '../../db/types';
import { applyCommitToCache } from '../query/applyCommitToCache';
import { supabase } from '../supabaseClient';
import { reportToast } from '../toasts/toastStore';
import { buildReplaceWithNewElementEnvelope } from './buildReplaceWithNewElementDeltas';

export type ReplaceWithNewElementStatus = 'idle' | 'replacing';

export interface UseReplaceWithNewElementInput {
  modelId: UUID;
  orgId: UUID;
  userId: UUID | null;
  element: ElementsHeadRow;
  facts: Map<string, FactsRow>;
  relationships: readonly RelationshipsHeadRow[];
  branch: BranchRow;
  expectedHeadCommitId: UUID;
  onReplaced: (newElementId: UUID) => void;
}

export interface UseReplaceWithNewElementResult {
  status: ReplaceWithNewElementStatus;
  error: string | null;
  replace: (plannedEnd: string, replacementName: string, copyEdgeIds?: ReadonlySet<UUID>) => Promise<void>;
}

/**
 * The I/O half of "replace A with a brand-new B" — `buildReplaceWithNewElementDeltas.ts`'s
 * own module comment explains the gap this closes and why it's a single
 * commit. This hook is the thin wrapper `useElementRetire.ts`/
 * `useElementCreate.ts` both already are: validate, build the envelope,
 * commit, surface the same conflict/error handling and change-branch save
 * toast those two hooks already give. `onReplaced` (unlike plain retire's
 * `onRetired`) carries the new element's id — the caller almost certainly
 * wants to navigate there, the way `useElementCreate.ts`'s own `onCreated`
 * already does.
 */
export function useReplaceWithNewElement(input: UseReplaceWithNewElementInput): UseReplaceWithNewElementResult {
  const { modelId, orgId, userId, element, facts, relationships, branch, expectedHeadCommitId, onReplaced } = input;
  const [status, setStatus] = useState<ReplaceWithNewElementStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const replace = useCallback(
    async (plannedEnd: string, replacementName: string, copyEdgeIds?: ReadonlySet<UUID>) => {
      if (!userId) {
        setError('You must be signed in to replace this.');
        return;
      }
      if (plannedEnd.trim() === '') {
        setError('Planned end is required to retire this.');
        return;
      }
      const validated = validateAttributeValue(element.element_type, 'plannedEnd', plannedEnd);
      if (!validated.ok) {
        setError(validated.error);
        return;
      }
      const trimmedName = replacementName.trim();
      if (trimmedName.length === 0) {
        setError('The replacement needs a name.');
        return;
      }
      setError(null);
      setStatus('replacing');

      try {
        const source = await getOrCreateManualSource(supabase, { id: crypto.randomUUID(), orgId, modelId, userId });
        const { envelope, newElementId } = buildReplaceWithNewElementEnvelope({
          element,
          facts,
          relationships,
          copyEdgeIds,
          plannedEnd: typeof validated.value === 'string' ? validated.value : plannedEnd,
          replacementName: trimmedName,
          sourceId: source.id,
          onMain: branch.kind === 'main',
          branch,
          expectedHeadCommitId,
        });

        const result = await commitToBranch(supabase, { modelId, branchId: branch.id, expectedHeadCommitId, envelope });
        if (!result.ok) {
          setStatus('idle');
          setError(
            result.reason === 'conflict'
              ? 'This element changed since you loaded it. Reload the page and try again.'
              : `Could not replace: ${result.message}`,
          );
          return;
        }

        setStatus('idle');
        if (branch.kind === 'change') reportToast(`Saved to change: ${branch.title ?? branch.name}`);
        // E8 item (3): seed the cache with the head this commit already
        // computed before navigating on — `onReplaced` navigates straight
        // to the new element's own page, which reads `mainBranch`/
        // `headAtCommit` from the same shared cache; without this, that
        // page could render against whichever commit_id was cached before
        // this one landed, and `elements_head` has zero rows for the new
        // element at that stale commit (SPEC §1 S-2/P-6) — "This element
        // is not present here." (`useElementCreate.ts`'s own identical
        // comment, for the identical create-then-navigate shape.)
        applyCommitToCache(queryClient, modelId, branch, result.commitId, result.newHead);
        onReplaced(newElementId);
      } catch (e) {
        setStatus('idle');
        setError(e instanceof Error ? e.message : 'Could not replace.');
      }
    },
    [element, facts, relationships, modelId, orgId, userId, branch, expectedHeadCommitId, onReplaced, queryClient],
  );

  return { status, error, replace };
}
