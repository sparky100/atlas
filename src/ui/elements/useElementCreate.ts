import { useCallback, useState } from 'react';
import { defaultCreateAttributes } from '../../contracts/attributeSchema';
import type { CommitEnvelope, Delta, ElementType, UUID } from '../../contracts/delta';
import { commitToBranch } from '../../db/commits';
import { describeEnvelope } from '../../engine/describeEnvelope';
import { getOrCreateManualSource } from '../../db/sources';
import type { BranchRow } from '../../db/types';
import { supabase } from '../supabaseClient';

export type ElementCreateStatus = 'idle' | 'creating';

export interface UseElementCreateResult {
  status: ElementCreateStatus;
  error: string | null;
  create: (name: string) => Promise<void>;
}

export interface UseElementCreateInput {
  modelId: UUID;
  orgId: UUID;
  userId: UUID | null;
  elementType: ElementType;
  /** Structural parent (ADR-001) — required non-null for container/component, null for system/actor (top-level). Not offered as a choice here: the page this control lives on (Landscape for system/actor, a system's own container list, a container's own component list) already fixes it. */
  parentId: UUID | null;
  /** Which branch this create commits to (Blocking: element creation — "main for architects/owners; the selected branch otherwise"): the caller resolves this the same way ElementPage.tsx already does, via `useEditingBranch`/`canEditBranch`. */
  branch: BranchRow;
  expectedHeadCommitId: UUID;
  onCreated: (elementId: UUID) => void;
}

/**
 * The search-first "Add" control's create step (Blocking: element
 * creation): one `element.create` delta through `commit_deltas`, with the
 * current user's manual source as provenance — the same shape
 * `useCapabilityCreate.ts` already established for capabilities,
 * generalised across every element type this control creates (system,
 * actor, container, component). `defaultCreateAttributes` fills in
 * whatever this type requires beyond a name (Blocking: element creation
 * never collects more than that at create time) — including, for a
 * system, `lifecycleStatus` defaulting to `active` on `main` and
 * `planned` on a change branch (`defaultCreateAttributes`'s own doc
 * comment explains why), driven by `branch.kind` here.
 */
export function useElementCreate(input: UseElementCreateInput): UseElementCreateResult {
  const { modelId, orgId, userId, elementType, parentId, branch, expectedHeadCommitId, onCreated } = input;
  const [status, setStatus] = useState<ElementCreateStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const create = useCallback(
    async (name: string) => {
      if (!userId) {
        setError(`You must be signed in to add a ${elementType}.`);
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
        const elementId = crypto.randomUUID();

        // The attributes shape is genuinely per-`elementType` (`ElementAttributesByType[T]`)
        // — this control builds it dynamically from the schema rather than a
        // literal per-type branch, so the cast is the one place that
        // generality meets the delta union's own type, same as
        // scripts/loadCapabilityMaps.ts-style bulk construction elsewhere.
        const delta = {
          kind: 'element.create',
          id: crypto.randomUUID(),
          elementId,
          elementType,
          name: trimmed,
          parentId,
          attributes: defaultCreateAttributes(elementType, { onMain: branch.kind === 'main' }),
          sourceId: source.id,
          confidence: 1,
        } as Delta;

        const deltas = [delta];
        const envelope: CommitEnvelope = {
          id: crypto.randomUUID(),
          branchId: branch.id,
          parentCommitId: expectedHeadCommitId,
          mergedBranchHeadCommitId: null,
          kind: 'manual',
          // `describeEnvelope` never actually calls the name lookup for an
          // `element.create` delta — the new element's name is right there
          // on the delta itself — so there's nothing for this hook to
          // build one out of.
          title: describeEnvelope(deltas, () => undefined),
          body: `Add ${elementType} "${trimmed}"`,
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
        onCreated(elementId);
      } catch (e) {
        setStatus('idle');
        setError(e instanceof Error ? e.message : `Could not add ${elementType}.`);
      }
    },
    [modelId, orgId, userId, elementType, parentId, branch, expectedHeadCommitId, onCreated],
  );

  return { status, error, create };
}
