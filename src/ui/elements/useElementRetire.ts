import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import type { CommitEnvelope, Delta, UUID } from '../../contracts/delta';
import { validateAttributeValue } from '../../contracts/attributeSchema';
import type { ElementsHeadRow, FactsRow, RelationshipsHeadRow } from '../../contracts/rows';
import { attributesRecord } from './attributesRecord';
import { commitToBranch } from '../../db/commits';
import { buildReplacesDelta } from '../../engine/buildReplacesDelta';
import { describeEnvelope } from '../../engine/describeEnvelope';
import { getOrCreateManualSource } from '../../db/sources';
import type { BranchRow } from '../../db/types';
import { applyCommitToCache } from '../query/applyCommitToCache';
import { supabase } from '../supabaseClient';
import { reportToast } from '../toasts/toastStore';

export type ElementRetireStatus = 'idle' | 'retiring';

export interface RetireReplacement {
  elementId: UUID;
  name: string;
}

export interface UseElementRetireResult {
  status: ElementRetireStatus;
  error: string | null;
  retire: (plannedEnd: string, replacement: RetireReplacement | null) => Promise<void>;
}

export interface UseElementRetireInput {
  modelId: UUID;
  orgId: UUID;
  userId: UUID | null;
  /**
   * The retiring element — a system, or (post-"platforms and modules") a
   * container/module. Not capability/component/actor: `lifecycleStatus`
   * (what this action actually sets) is only a field `SystemAttributes`/
   * `ContainerAttributes` carry.
   */
  element: ElementsHeadRow;
  facts: Map<string, FactsRow>;
  /** The retiring element's own live relationships (`ElementPageData.relationships`) — used to find its own `supports` edges when a replacement is given; no new round trip. */
  relationships: readonly RelationshipsHeadRow[];
  relationshipFacts: ReadonlyMap<UUID, Map<string, FactsRow>>;
  /** Which branch this commits to — see `useElementEditor.ts`'s identical `branch` doc comment. */
  branch: BranchRow;
  expectedHeadCommitId: UUID;
  onRetired: () => void;
}

/**
 * Prompt 7k item 5's "Retire…" (generalised beyond system-only by
 * "platforms and modules" — a platform's module is a Container, and
 * `ContainerAttributes` now carries `lifecycleStatus`/`plannedEnd` too):
 * sets `lifecycleStatus: 'retiring'` and `plannedEnd` via the same
 * `element.update` shape `useElementEditor.ts` already uses (no new engine
 * primitive), plus an optional "replaced by" picker that (a) transfers the
 * retiring element's own `supports` edges to the replacement, one
 * capability at a time, in the *same* commit — old edge retracted, new
 * edge created `role: 'secondary'` — and (b) records the replacement
 * itself as a first-class fact: a `replaces` edge (ADR-001 amendment,
 * `buildReplacesDelta`) from the replacement to the retiring element. (a)
 * is what actually clears a capability's "lifecycle exposure" colour-by
 * (`src/ui/capabilityMap/metrics.ts`'s `lifecycleExposure`): that check
 * reads every *live* `supports` edge into a capability, so leaving the
 * retiring element's own edge in place would keep the capability reading
 * exposed regardless of what the replacement also supports.
 *
 * New edges always get `role: 'secondary'`, never a copy of the original
 * edge's own role — promoting one to `role: 'primary'` could collide with
 * a `primary` edge the replacement already has elsewhere (C17, anchored on
 * `fromElementId`), and finding out requires reading the replacement's own
 * relationships at whatever ref is selected, which for a change branch
 * means the branch-projection path `useElementPage.ts`'s own module
 * comment describes (its materialised-table read is empty for a branch's
 * own commits) — not worth adding here. A user who wants the replacement's
 * new supports edge to be primary can promote it afterward via the
 * existing supports "primary?" prompt.
 *
 * Nor does this hook pre-check whether the replacement already supports
 * one of the transferred capabilities (same branch-projection reasoning) —
 * C10 (no duplicate live relationship) is enforced at the commit boundary
 * regardless, so a genuine duplicate rejects the whole commit with the
 * server's own conflict message rather than silently succeeding or
 * silently dropping one edge.
 */
export function useElementRetire(input: UseElementRetireInput): UseElementRetireResult {
  const { modelId, orgId, userId, element, facts, relationships, relationshipFacts, branch, expectedHeadCommitId, onRetired } = input;
  const [status, setStatus] = useState<ElementRetireStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const retire = useCallback(
    async (plannedEnd: string, replacement: RetireReplacement | null) => {
      if (!userId) {
        setError('You must be signed in to retire this.');
        return;
      }
      // `plannedEnd` is optional on `SystemAttributes`/`ContainerAttributes`
      // in general (an ordinary edit may set it without touching lifecycle
      // at all), but this action's whole point is recording one — enforced
      // here, at the product level, rather than by widening the schema's
      // own `required` flag for every other caller of
      // `validateAttributeValue`.
      if (plannedEnd.trim() === '') {
        setError('Planned end is required to retire this.');
        return;
      }
      const validated = validateAttributeValue(element.element_type, 'plannedEnd', plannedEnd);
      if (!validated.ok) {
        setError(validated.error);
        return;
      }
      setError(null);
      setStatus('retiring');

      try {
        const source = await getOrCreateManualSource(supabase, { id: crypto.randomUUID(), orgId, modelId, userId });
        const deltas: Delta[] = [];

        const currentLifecycleStatus = attributesRecord(element.attributes).lifecycleStatus;
        if (currentLifecycleStatus !== 'retiring') {
          deltas.push({
            kind: 'element.update',
            id: crypto.randomUUID(),
            elementId: element.element_id,
            elementType: element.element_type,
            attribute: 'lifecycleStatus',
            value: 'retiring',
            previousDeltaId: facts.get('lifecycleStatus')?.delta_id ?? element.exists_delta_id,
            sourceId: source.id,
            confidence: 1,
          } as Delta);
        }

        const currentPlannedEnd = attributesRecord(element.attributes).plannedEnd;
        if (currentPlannedEnd !== validated.value) {
          deltas.push({
            kind: 'element.update',
            id: crypto.randomUUID(),
            elementId: element.element_id,
            elementType: element.element_type,
            attribute: 'plannedEnd',
            value: validated.value,
            previousDeltaId: facts.get('plannedEnd')?.delta_id ?? element.exists_delta_id,
            sourceId: source.id,
            confidence: 1,
          } as Delta);
        }

        if (replacement) {
          const ownSupportsEdges = relationships.filter((rel) => rel.relationship_type === 'supports' && rel.from_element_id === element.element_id);
          for (const edge of ownSupportsEdges) {
            deltas.push({
              kind: 'relationship.retract',
              id: crypto.randomUUID(),
              relationshipId: edge.relationship_id,
              relationshipType: 'supports',
              previousDeltaId: relationshipFacts.get(edge.relationship_id)?.get('$exists')?.delta_id ?? edge.exists_delta_id,
              sourceId: source.id,
              confidence: 1,
            });

            const description = attributesRecord(edge.attributes).description;
            deltas.push({
              kind: 'relationship.create',
              id: crypto.randomUUID(),
              relationshipId: crypto.randomUUID(),
              relationshipType: 'supports',
              fromElementId: replacement.elementId,
              toElementId: edge.to_element_id,
              attributes: typeof description === 'string' && description.trim() !== '' ? { role: 'secondary', description } : { role: 'secondary' },
              sourceId: source.id,
              confidence: 1,
            });
          }

          deltas.push(buildReplacesDelta(replacement.elementId, element.element_id, source.id));
        }

        if (deltas.length === 0) {
          setStatus('idle');
          return;
        }

        const nameLookup = (id: UUID) => (id === element.element_id ? element.name : id === replacement?.elementId ? replacement.name : undefined);
        const envelope: CommitEnvelope = {
          id: crypto.randomUUID(),
          branchId: branch.id,
          parentCommitId: expectedHeadCommitId,
          mergedBranchHeadCommitId: null,
          kind: 'manual',
          title: describeEnvelope(deltas, nameLookup),
          body: replacement ? `Retire ${element.name}, replaced by ${replacement.name}` : `Retire ${element.name}`,
          deltas,
        };

        const result = await commitToBranch(supabase, { modelId, branchId: branch.id, expectedHeadCommitId, envelope });
        if (!result.ok) {
          setStatus('idle');
          setError(
            result.reason === 'conflict'
              ? 'This element changed since you loaded it. Reload the page and try again.'
              : `Could not retire: ${result.message}`,
          );
          return;
        }

        setStatus('idle');
        // Item 2: see useElementEditor.ts's identical comment.
        if (branch.kind === 'change') reportToast(`Saved to change: ${branch.title ?? branch.name}`);
        // E8 item (3): seeds the cache with the head this commit already computed — see applyCommitToCache.ts's own comment.
        applyCommitToCache(queryClient, modelId, branch, result.commitId, result.newHead);
        onRetired();
      } catch (e) {
        setStatus('idle');
        setError(e instanceof Error ? e.message : 'Could not retire.');
      }
    },
    [element, facts, relationships, relationshipFacts, modelId, orgId, userId, branch, expectedHeadCommitId, onRetired, queryClient],
  );

  return { status, error, retire };
}
