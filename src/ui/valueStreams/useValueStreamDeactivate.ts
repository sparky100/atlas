import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import type { CommitEnvelope, Delta, UUID } from '../../contracts/delta';
import type { ElementsHeadRow, FactsRow } from '../../contracts/rows';
import { attributesRecord } from '../elements/attributesRecord';
import { commitToBranch } from '../../db/commits';
import { describeEnvelope } from '../../engine/describeEnvelope';
import { getOrCreateManualSource } from '../../db/sources';
import type { BranchRow } from '../../db/types';
import { applyCommitToCache } from '../query/applyCommitToCache';
import { supabase } from '../supabaseClient';
import { reportToast } from '../toasts/toastStore';

export type ValueStreamDeactivateStatus = 'idle' | 'saving';

export interface UseValueStreamDeactivateInput {
  modelId: UUID;
  orgId: UUID;
  userId: UUID | null;
  /** The stream itself (`parent_id === null`) — never a stage; a stage follows its own stream (ADR-023), so this action is never offered on one (`ElementPage.tsx`'s own gate). */
  element: ElementsHeadRow;
  facts: Map<string, FactsRow>;
  branch: BranchRow;
  expectedHeadCommitId: UUID;
  onChanged: () => void;
}

export interface UseValueStreamDeactivateResult {
  status: ValueStreamDeactivateStatus;
  error: string | null;
  deactivate: (reason: string) => Promise<void>;
  reactivate: () => Promise<void>;
}

/**
 * ADR-023's "a stream is deactivated, never deleted": `Deactivate…`/
 * `Reactivate…` on a stream's own element page, writing the three plain
 * `inactive`/`inactiveSince`/`inactiveReason` attributes
 * (`ValueStreamAttributes`) via ordinary `element.update` deltas — no new
 * engine primitive, no migration (attribute-only, ADR-001's own
 * precedent). All three fields are `editable: false` in
 * `attributeSchema.ts` ("written only by this action") so, like
 * `useElementRetire.ts`'s own `lifecycleStatus`, the deltas below are built
 * directly rather than through `validateAttributeValue` (which refuses any
 * `editable: false` field outright).
 *
 * `reactivate` only ever flips `inactive` back to `false` — `inactiveSince`/
 * `inactiveReason` are left as the historical record of the last
 * deactivation rather than cleared, the same "nothing here is a hard
 * delete" spirit CLAUDE.md rule 5 and ADR-023's own "no known data-loss
 * path" both require.
 */
export function useValueStreamDeactivate(input: UseValueStreamDeactivateInput): UseValueStreamDeactivateResult {
  const { modelId, orgId, userId, element, facts, branch, expectedHeadCommitId, onChanged } = input;
  const [status, setStatus] = useState<ValueStreamDeactivateStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const commit = useCallback(
    async (deltas: Delta[], body: string) => {
      if (deltas.length === 0) {
        setStatus('idle');
        return;
      }
      const envelope: CommitEnvelope = {
        id: crypto.randomUUID(),
        branchId: branch.id,
        parentCommitId: expectedHeadCommitId,
        mergedBranchHeadCommitId: null,
        kind: 'manual',
        title: describeEnvelope(deltas, (id) => (id === element.element_id ? element.name : undefined)),
        body,
        deltas,
      };
      const result = await commitToBranch(supabase, { modelId, branchId: branch.id, expectedHeadCommitId, envelope });
      if (!result.ok) {
        setStatus('idle');
        setError(result.reason === 'conflict' ? 'This element changed since you loaded it. Reload the page and try again.' : `Could not save: ${result.message}`);
        return;
      }
      setStatus('idle');
      if (branch.kind === 'change') reportToast(`Saved to change: ${branch.title ?? branch.name}`);
      applyCommitToCache(queryClient, modelId, branch, result.commitId, result.newHead);
      onChanged();
    },
    [branch, element, expectedHeadCommitId, modelId, onChanged, queryClient],
  );

  const deactivate = useCallback(
    async (reason: string) => {
      if (!userId) {
        setError('You must be signed in to deactivate this.');
        return;
      }
      if (reason.trim() === '') {
        setError('A reason is required to deactivate a value stream.');
        return;
      }
      setError(null);
      setStatus('saving');
      try {
        const source = await getOrCreateManualSource(supabase, { id: crypto.randomUUID(), orgId, modelId, userId });
        const current = attributesRecord(element.attributes);
        const today = new Date().toISOString().slice(0, 10);
        const deltas: Delta[] = [];
        function pushUpdate(attribute: 'inactive' | 'inactiveSince' | 'inactiveReason', value: boolean | string) {
          deltas.push({
            kind: 'element.update',
            id: crypto.randomUUID(),
            elementId: element.element_id,
            elementType: 'value_stream',
            attribute,
            value,
            previousDeltaId: facts.get(attribute)?.delta_id ?? element.exists_delta_id,
            sourceId: source.id,
            confidence: 1,
          } as Delta);
        }
        if (current.inactive !== true) pushUpdate('inactive', true);
        if (current.inactiveSince !== today) pushUpdate('inactiveSince', today);
        if (current.inactiveReason !== reason) pushUpdate('inactiveReason', reason);
        await commit(deltas, `Deactivate ${element.name}: ${reason}`);
      } catch (e) {
        setStatus('idle');
        setError(e instanceof Error ? e.message : 'Could not deactivate.');
      }
    },
    [commit, element, facts, modelId, orgId, userId],
  );

  const reactivate = useCallback(async () => {
    if (!userId) {
      setError('You must be signed in to reactivate this.');
      return;
    }
    setError(null);
    setStatus('saving');
    try {
      const source = await getOrCreateManualSource(supabase, { id: crypto.randomUUID(), orgId, modelId, userId });
      const current = attributesRecord(element.attributes);
      const deltas: Delta[] =
        current.inactive === true
          ? [
              {
                kind: 'element.update',
                id: crypto.randomUUID(),
                elementId: element.element_id,
                elementType: 'value_stream',
                attribute: 'inactive',
                value: false,
                previousDeltaId: facts.get('inactive')?.delta_id ?? element.exists_delta_id,
                sourceId: source.id,
                confidence: 1,
              },
            ]
          : [];
      await commit(deltas, `Reactivate ${element.name}`);
    } catch (e) {
      setStatus('idle');
      setError(e instanceof Error ? e.message : 'Could not reactivate.');
    }
  }, [commit, element, facts, modelId, orgId, userId]);

  return { status, error, deactivate, reactivate };
}
