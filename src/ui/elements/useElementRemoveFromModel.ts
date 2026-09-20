import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import type { CommitEnvelope, Delta, UUID } from '../../contracts/delta';
import type { ElementsHeadRow, FactsRow, RelationshipsHeadRow } from '../../contracts/rows';
import { commitToBranch } from '../../db/commits';
import { describeEnvelope } from '../../engine/describeEnvelope';
import { getOrCreateManualSource } from '../../db/sources';
import type { BranchRow } from '../../db/types';
import { invalidateModelHead } from '../query/invalidateModelHead';
import { supabase } from '../supabaseClient';
import { reportToast } from '../toasts/toastStore';

export type ElementRemoveFromModelStatus = 'idle' | 'removing';

export interface UseElementRemoveFromModelResult {
  status: ElementRemoveFromModelStatus;
  error: string | null;
  remove: () => Promise<void>;
}

export interface UseElementRemoveFromModelInput {
  modelId: UUID;
  orgId: UUID;
  userId: UUID | null;
  element: ElementsHeadRow;
  facts: Map<string, FactsRow>;
  /** Every live relationship with `element` as either endpoint (`ElementPageData.relationships`) — C8's own "endpoint" half of what a retract cascade must cover. */
  relationships: readonly RelationshipsHeadRow[];
  relationshipFacts: ReadonlyMap<UUID, Map<string, FactsRow>>;
  /** Which branch this commits to — see `useElementEditor.ts`'s identical `branch` doc comment. */
  branch: BranchRow;
  expectedHeadCommitId: UUID;
  onRemoved: () => void;
}

/**
 * Prompt 7k item 5's "Remove from model…": `element.retract` cascading
 * every relationship touching the element, in one commit — C8's
 * relationship half ("every relationship with the element as an endpoint...
 * is retracted... in the same commit"). Replaces `useElementRetract.ts`
 * (Sprint U4-1, folded into `CapabilityRetractAction.tsx`), which only ever
 * issued a bare `element.retract` and required callers to pre-check the
 * element had zero relationships — a strict, more limited case of what
 * this hook does generally, for every element type, not just capability.
 *
 * This hook does **not** attempt C8's other half (re-parenting or
 * retracting every child whose `parentId` is this element) — a real,
 * documented engine gap (see `docs/ADR-000-foundations.md`'s amendment for
 * this item), not silently overclaimed here. Callers must gate the menu
 * item entirely — not shown disabled — when the element has any live
 * children (`ElementPageData.children`), the same "omitted, not disabled"
 * convention `ElementHeader.tsx` already uses for every other optional
 * action, and the same one `useElementRetract.ts`'s own `canRetract`
 * comment established for retract itself. `relationships`/`relationshipFacts`
 * are exactly `ElementPageData`'s own fields — no new round trip.
 */
export function useElementRemoveFromModel(input: UseElementRemoveFromModelInput): UseElementRemoveFromModelResult {
  const { modelId, orgId, userId, element, facts, relationships, relationshipFacts, branch, expectedHeadCommitId, onRemoved } = input;
  const [status, setStatus] = useState<ElementRemoveFromModelStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const remove = useCallback(async () => {
    if (!userId) {
      setError('You must be signed in to remove this from the model.');
      return;
    }
    setError(null);
    setStatus('removing');

    try {
      const source = await getOrCreateManualSource(supabase, { id: crypto.randomUUID(), orgId, modelId, userId });

      const relationshipRetracts: Delta[] = relationships.map(
        (rel) =>
          ({
            kind: 'relationship.retract',
            id: crypto.randomUUID(),
            relationshipId: rel.relationship_id,
            relationshipType: rel.relationship_type,
            previousDeltaId: relationshipFacts.get(rel.relationship_id)?.get('$exists')?.delta_id ?? rel.exists_delta_id,
            sourceId: source.id,
            confidence: 1,
          }),
      );

      const elementRetract: Delta = {
        kind: 'element.retract',
        id: crypto.randomUUID(),
        elementId: element.element_id,
        elementType: element.element_type,
        previousDeltaId: facts.get('$exists')?.delta_id ?? element.exists_delta_id,
        sourceId: source.id,
        confidence: 1,
      };

      // Relationship retracts first, then the element retract — no
      // engine-mandated order for a commit of only retracts, but this
      // keeps the element's own delta last, matching C8's own framing of
      // "the relationships, then the element".
      const deltas = [...relationshipRetracts, elementRetract];

      const envelope: CommitEnvelope = {
        id: crypto.randomUUID(),
        branchId: branch.id,
        parentCommitId: expectedHeadCommitId,
        mergedBranchHeadCommitId: null,
        kind: 'manual',
        title: describeEnvelope(deltas, (id) => (id === element.element_id ? element.name : undefined)),
        body: `Remove ${element.name} from the model`,
        deltas,
      };

      const result = await commitToBranch(supabase, { modelId, branchId: branch.id, expectedHeadCommitId, envelope });
      if (!result.ok) {
        setStatus('idle');
        setError(
          result.reason === 'conflict'
            ? 'This element changed since you loaded it. Reload the page and try again.'
            : `Could not remove: ${result.message}`,
        );
        return;
      }

      setStatus('idle');
      // Item 2: see useElementEditor.ts's identical comment.
      if (branch.kind === 'change') reportToast(`Saved to change: ${branch.title ?? branch.name}`);
      // E8 item (1): invalidates the shared main/editing-branch cache — see invalidateModelHead.ts's own comment.
      void invalidateModelHead(queryClient, modelId);
      onRemoved();
    } catch (e) {
      setStatus('idle');
      setError(e instanceof Error ? e.message : 'Could not remove from the model.');
    }
  }, [element, facts, relationships, relationshipFacts, modelId, orgId, userId, branch, expectedHeadCommitId, onRemoved, queryClient]);

  return { status, error, remove };
}
