import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import type { CommitEnvelope, Delta, UUID } from '../../contracts/delta';
import type { RelationshipsHeadRow } from '../../contracts/rows';
import { commitToBranch } from '../../db/commits';
import { describeEnvelope } from '../../engine/describeEnvelope';
import { getOrCreateManualSource } from '../../db/sources';
import type { BranchRow } from '../../db/types';
import { applyCommitToCache } from '../query/applyCommitToCache';
import { supabase } from '../supabaseClient';
import { reportToast } from '../toasts/toastStore';

export type RelationshipRemoveStatus = 'idle' | 'removing';

/** Bundles a `relationship.update role:'primary'` into the same commit as the retract — "Relationship removal"'s "make `<other>` primary" affordance, mirroring `RelationshipAdd.tsx`'s own demote-current-primary bundling in reverse. */
export interface RelationshipPromotion {
  relationshipId: UUID;
  /** C6's optimistic-concurrency token for the promoted edge's own `role` fact — the same `relationshipFacts.get(id)?.get('role')?.delta_id ?? row.exists_delta_id` fallback `RelationshipAdd.tsx`'s `currentPrimaryDemotion` already uses. */
  previousDeltaId: UUID;
}

export interface UseRelationshipRemoveResult {
  status: RelationshipRemoveStatus;
  error: string | null;
  /**
   * `promotion`, when given, folds one extra `relationship.update` into
   * the same commit — the exact same "pass the bundled extra delta as a
   * call argument, not hook input" shape `useRelationshipCreate.ts`'s own
   * `create(otherElementId, otherElementName, attributesOverride,
   * demotion)` already uses for its own reverse case (demoting the current
   * primary on create); reading it from hook input instead would risk the
   * classic stale-closure bug (`setPromotion` then immediately calling
   * `remove()` wouldn't see the just-set state in time).
   */
  remove: (promotion?: RelationshipPromotion | null) => Promise<void>;
}

export interface UseRelationshipRemoveInput {
  modelId: UUID;
  orgId: UUID;
  userId: UUID | null;
  /** The one relationship being retracted. */
  relationship: RelationshipsHeadRow;
  /** This relationship's own `$exists` delta id, for C6 — `relationshipFacts.get(relationship.relationship_id)?.get('$exists')?.delta_id ?? relationship.exists_delta_id`, the same fallback `useElementRemoveFromModel.ts` uses for the analogous element case. */
  existsDeltaId: UUID;
  /** For the generated commit title/body — the two endpoint names, in `from`/`to` order matching `relationship.from_element_id`/`to_element_id`, not necessarily "this element"/"the other one". */
  fromElementName: string;
  toElementName: string;
  /** Which branch this commits to — see `useElementEditor.ts`'s identical `branch` doc comment. */
  branch: BranchRow;
  expectedHeadCommitId: UUID;
  onRemoved: () => void;
}

/**
 * "Relationship removal": a single `relationship.retract`, optionally
 * bundled in the same commit with a `relationship.update` that promotes
 * another edge to `role: 'primary'`. Mirrors
 * `useElementRemoveFromModel.ts`'s minimal delta-building shape almost
 * verbatim — the relationship-shaped case that hook's own doc comment
 * doesn't cover (that hook cascades every relationship an *element*
 * touches; this one retracts exactly one relationship and nothing else,
 * with no cascade of any kind).
 */
export function useRelationshipRemove(input: UseRelationshipRemoveInput): UseRelationshipRemoveResult {
  const { modelId, orgId, userId, relationship, existsDeltaId, fromElementName, toElementName, branch, expectedHeadCommitId, onRemoved } = input;
  const [status, setStatus] = useState<RelationshipRemoveStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const remove = useCallback(async (promotion: RelationshipPromotion | null = null) => {
    if (!userId) {
      setError('You must be signed in to remove this relationship.');
      return;
    }
    setError(null);
    setStatus('removing');

    try {
      const source = await getOrCreateManualSource(supabase, { id: crypto.randomUUID(), orgId, modelId, userId });

      const retract: Delta = {
        kind: 'relationship.retract',
        id: crypto.randomUUID(),
        relationshipId: relationship.relationship_id,
        relationshipType: relationship.relationship_type,
        previousDeltaId: existsDeltaId,
        sourceId: source.id,
        confidence: 1,
      };

      // `RelationshipUpdate<R>` is a distributive conditional type keyed on
      // a literal `R` (`src/contracts/delta.ts`) — a promotion only ever
      // exists for a `supports` row (`RelationshipRemove.tsx`'s own
      // `isPrimaryOutboundSupportsRow` gate), so `'supports'` is written
      // literally here rather than widened from `relationship.relationship_type`;
      // TS already resolves the right union member from the literal, no
      // `as Delta` escape hatch needed (unlike `useElementEditor.ts`'s own
      // case, where the type being generalised over isn't a literal).
      const promote: Delta[] = promotion
        ? [
            {
              kind: 'relationship.update',
              id: crypto.randomUUID(),
              relationshipId: promotion.relationshipId,
              relationshipType: 'supports',
              attribute: 'role',
              value: 'primary',
              previousDeltaId: promotion.previousDeltaId,
              sourceId: source.id,
              confidence: 1,
            },
          ]
        : [];

      const deltas = [retract, ...promote];

      const envelope: CommitEnvelope = {
        id: crypto.randomUUID(),
        branchId: branch.id,
        parentCommitId: expectedHeadCommitId,
        mergedBranchHeadCommitId: null,
        kind: 'manual',
        // `describeEnvelope`'s own doc comment: `relationship.retract`/
        // `.update` carry only `relationshipId`, never the endpoint ids, so
        // it never calls `nameLookup` for either kind — the title falls
        // back to a generic, type-only description regardless of what this
        // callback returns. `body` below is where the real names live.
        title: describeEnvelope(deltas, () => undefined),
        body: `Remove ${relationship.relationship_type}: ${fromElementName} → ${toElementName}`,
        deltas,
      };

      const result = await commitToBranch(supabase, { modelId, branchId: branch.id, expectedHeadCommitId, envelope });
      if (!result.ok) {
        setStatus('idle');
        setError(
          result.reason === 'conflict'
            ? 'This relationship changed since you loaded it. Reload the page and try again.'
            : `Could not remove: ${result.message}`,
        );
        return;
      }

      setStatus('idle');
      // Item 2: see useElementEditor.ts's identical comment.
      if (branch.kind === 'change') reportToast(`Saved to change: ${branch.title ?? branch.name}`);
      // E8 item (3): seeds the cache with the head this commit already computed — see applyCommitToCache.ts's own comment.
      applyCommitToCache(queryClient, modelId, branch, result.commitId, result.newHead);
      onRemoved();
    } catch (e) {
      setStatus('idle');
      setError(e instanceof Error ? e.message : 'Could not remove this relationship.');
    }
  }, [modelId, orgId, userId, relationship, existsDeltaId, fromElementName, toElementName, branch, expectedHeadCommitId, onRemoved, queryClient]);

  return { status, error, remove };
}
