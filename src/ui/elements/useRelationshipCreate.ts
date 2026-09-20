import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import type { CommitEnvelope, Delta, RelationshipType, UUID } from '../../contracts/delta';
import type { Json } from '../../contracts/rows';
import { commitToBranch } from '../../db/commits';
import { describeEnvelope, type NameLookup } from '../../engine/describeEnvelope';
import { getOrCreateManualSource } from '../../db/sources';
import type { BranchRow } from '../../db/types';
import { applyCommitToCache } from '../query/applyCommitToCache';
import { supabase } from '../supabaseClient';
import { reportToast } from '../toasts/toastStore';

export type RelationshipCreateStatus = 'idle' | 'creating';

/** A second, same-commit `relationship.update` alongside the create — Sprint U4-1 B4's "at most one primary per system" swap: promoting a new `supports` edge to `role: 'primary'` demotes whichever edge held it before, in the same commit, or the DB's own partial unique index (`relationships_head_one_primary_supports_per_system`) would reject the commit outright. */
export interface RelationshipCreateDemotion {
  relationshipId: UUID;
  /** The delta currently asserting the attribute being changed (`relationshipFacts.get(relationshipId)?.get(attribute)?.delta_id`), falling back to the relationship's own `exists_delta_id` when nothing has updated that attribute since creation — same fallback shape `useElementRename.ts`/`useElementEditor.ts` already use for an element's own facts. */
  previousDeltaId: UUID;
  attribute: string;
  value: Json;
}

export interface UseRelationshipCreateResult {
  status: RelationshipCreateStatus;
  error: string | null;
  /**
   * `otherElementName` is only for the generated commit title
   * (`describeEnvelope`'s `nameLookup`, e.g. "Link PowerON supports Outage
   * & Fault Management") — the caller already has it in hand, it's the
   * very search result being clicked. `attributesOverride`, when given,
   * replaces this hook's own default attributes entirely — B4's `supports`
   * picker builds `{ role: 'primary' | 'secondary' }` itself (only the
   * caller knows the answer to "primary?"), Prompt 7k item 2's `owns`
   * picker builds `{ role: 'business' | 'technical' | 'service' }` the
   * same way (only the caller knows the answer to "which role?"), and
   * Handoff — Flow: Add a system, step 6's `uses`/`flows_to` verb phrase
   * builds `{ description }` the same way (there is no separate verb field
   * in the contract — `UsesAttributes`/`FlowsToAttributes.description` is
   * it). Every real caller's own default (`relationshipType === 'owns' ?
   * {role:'business'} : {}`) is `{}` whenever it passes an override at
   * all, so replace-vs-merge never actually differs for any of them —
   * override is simpler. `demotion`, when given, folds one extra
   * `relationship.update` into the same commit.
   */
  create: (otherElementId: UUID, otherElementName: string, attributesOverride?: Record<string, Json>, demotion?: RelationshipCreateDemotion | null) => Promise<void>;
}

export interface UseRelationshipCreateInput {
  modelId: UUID;
  orgId: UUID;
  userId: UUID | null;
  relationshipType: RelationshipType;
  direction: 'outbound' | 'inbound';
  /** The element whose Relationships section this "+ Add" lives on. */
  elementId: UUID;
  /** Same element's name — only for the generated commit title, see `create`'s own doc comment. */
  elementName: string;
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
 * `owns.role` is the one relationship attribute type that's required
 * (`OwnsAttributes`, src/contracts/delta.ts) — defaulted to `'business'`
 * here (Prompt 7k item 1's own "defaults to business on capability
 * targets" wording; this bare fallback has no target-type context of its
 * own to prompt on a system target the way `RelationshipAdd.tsx`'s own
 * staged prompt does, so it always assumes the more common case), and
 * `maxPrimaryPerTo: 1` per role (relationship_type_rules, C17) is enforced
 * server-side regardless of what this default guesses.
 */
export function useRelationshipCreate(input: UseRelationshipCreateInput): UseRelationshipCreateResult {
  const { modelId, orgId, userId, relationshipType, direction, elementId, elementName, branch, expectedHeadCommitId, onCreated } = input;
  const [status, setStatus] = useState<RelationshipCreateStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const create = useCallback(
    async (otherElementId: UUID, otherElementName: string, attributesOverride?: Record<string, Json>, demotion?: RelationshipCreateDemotion | null) => {
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
        // UsesAttributes/FlowsToAttributes). `attributesOverride` always
        // replaces this when given.
        const attributes = attributesOverride ?? (relationshipType === 'owns' ? { role: 'business' } : {});

        const createDelta = {
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

        const demoteDelta: Delta | null = demotion
          ? ({
              kind: 'relationship.update',
              id: crypto.randomUUID(),
              relationshipId: demotion.relationshipId,
              relationshipType,
              attribute: demotion.attribute,
              value: demotion.value,
              previousDeltaId: demotion.previousDeltaId,
              sourceId: source.id,
              confidence: 1,
            } as Delta)
          : null;
        // The demotion lands first — describeEnvelope's own 2-delta
        // "create and link" combination only recognises `[element.create,
        // relationship.create]`, so ordering the create delta last here
        // just falls through to its generic "(2 changes)" fallback rather
        // than accidentally matching the wrong combined phrasing.
        const deltas = demoteDelta ? [demoteDelta, createDelta] : [createDelta];

        const nameLookup: NameLookup = (id) => (id === elementId ? elementName : id === otherElementId ? otherElementName : undefined);
        const envelope: CommitEnvelope = {
          id: crypto.randomUUID(),
          branchId: branch.id,
          parentCommitId: expectedHeadCommitId,
          mergedBranchHeadCommitId: null,
          kind: 'manual',
          title: describeEnvelope(deltas, nameLookup),
          body: `Add ${relationshipType} relationship`,
          deltas,
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
        // Item 2: see useElementEditor.ts's identical comment.
        if (branch.kind === 'change') reportToast(`Saved to change: ${branch.title ?? branch.name}`);
        // E8 item (3): seeds the cache with the head this commit already computed — see applyCommitToCache.ts's own comment.
        applyCommitToCache(queryClient, modelId, branch, result.commitId, result.newHead);
        onCreated();
      } catch (e) {
        setStatus('idle');
        setError(e instanceof Error ? e.message : 'Could not add relationship.');
      }
    },
    [modelId, orgId, userId, relationshipType, direction, elementId, elementName, branch, expectedHeadCommitId, onCreated, queryClient],
  );

  return { status, error, create };
}
