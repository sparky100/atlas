import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import type { CommitEnvelope, Delta, UUID } from '../../contracts/delta';
import type { ElementsHeadRow, FactsRow } from '../../contracts/rows';
import { createAlias } from '../../db/aliases';
import { commitToBranch } from '../../db/commits';
import { describeEnvelope } from '../../engine/describeEnvelope';
import { getOrCreateManualSource } from '../../db/sources';
import type { BranchRow } from '../../db/types';
import { invalidateModelHead } from '../query/invalidateModelHead';
import { supabase } from '../supabaseClient';
import { reportToast } from '../toasts/toastStore';

export type ElementRenameStatus = 'idle' | 'renaming' | 'submitting';

export interface UseElementRenameResult {
  status: ElementRenameStatus;
  value: string;
  submitError: string | null;
  startRenaming: () => void;
  cancelRenaming: () => void;
  setValue: (value: string) => void;
  save: () => Promise<void>;
}

export interface UseElementRenameInput {
  modelId: UUID;
  orgId: UUID;
  userId: UUID | null;
  element: ElementsHeadRow;
  facts: Map<string, FactsRow>;
  /** Which branch this rename commits to — see useElementEditor.ts's `branch` doc comment (Sprint C1). */
  branch: BranchRow;
  expectedHeadCommitId: UUID;
  onSaved: () => void;
}

/**
 * Editing at `main` or on a draft change branch (same gate as
 * useElementEditor.ts; `name` just isn't one of that hook's schema-driven
 * fields — it's a promoted column, not a `CapabilityAttributes` key, per
 * src/contracts/attributeSchema.ts). Renaming during tailoring must not
 * make the old wording unmatchable by capture: alongside the
 * `element.update` delta, this records the *old* name as a `name`-type
 * alias (SPEC §3.6, the user's explicit instruction for this sprint's
 * tailoring flow) — inserted *before* the rename commits, not after, so a
 * failure partway through leaves at worst a harmless alias whose value
 * still equals the element's (unchanged) current name, never a rename that
 * landed with its old identifier unrecoverable for capture matching.
 */
export function useElementRename(input: UseElementRenameInput): UseElementRenameResult {
  const { modelId, orgId, userId, element, facts, branch, expectedHeadCommitId, onSaved } = input;
  const [status, setStatus] = useState<ElementRenameStatus>('idle');
  const [value, setValueState] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const startRenaming = useCallback(() => {
    setValueState(element.name);
    setSubmitError(null);
    setStatus('renaming');
  }, [element.name]);

  const cancelRenaming = useCallback(() => {
    setStatus('idle');
    setSubmitError(null);
  }, []);

  const setValue = useCallback((next: string) => {
    setValueState(next);
  }, []);

  const save = useCallback(async () => {
    if (!userId) {
      setSubmitError('You must be signed in to rename.');
      return;
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      setSubmitError('Name cannot be empty.');
      return;
    }
    if (trimmed === element.name) {
      setStatus('idle');
      return;
    }
    setSubmitError(null);
    setStatus('submitting');

    try {
      const source = await getOrCreateManualSource(supabase, { id: crypto.randomUUID(), orgId, modelId, userId });

      await createAlias(supabase, {
        id: crypto.randomUUID(),
        orgId,
        modelId,
        elementId: element.element_id,
        aliasValue: element.name,
        aliasType: 'name',
        sourceId: source.id,
        createdBy: userId,
      });

      const delta = {
        kind: 'element.update',
        id: crypto.randomUUID(),
        elementId: element.element_id,
        elementType: element.element_type,
        attribute: 'name',
        value: trimmed,
        previousDeltaId: facts.get('name')?.delta_id ?? element.exists_delta_id,
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
        // `element.name` is still the *old* name here — the rename hasn't
        // committed yet — which is exactly what "Rename {old} to {new}"
        // needs.
        title: describeEnvelope(deltas, (id) => (id === element.element_id ? element.name : undefined)),
        body: `Rename "${element.name}" to "${trimmed}"`,
        deltas,
      };

      const result = await commitToBranch(supabase, { modelId, branchId: branch.id, expectedHeadCommitId, envelope });
      if (!result.ok) {
        setStatus('renaming');
        setSubmitError(
          result.reason === 'conflict'
            ? 'This element changed since you loaded it. Reload the page and try again.'
            : `Could not save: ${result.message}`,
        );
        return;
      }

      setStatus('idle');
      // Item 2: see useElementEditor.ts's identical comment.
      if (branch.kind === 'change') reportToast(`Saved to change: ${branch.title ?? branch.name}`);
      // E8 item (1): invalidates the shared main/editing-branch cache — see invalidateModelHead.ts's own comment.
      void invalidateModelHead(queryClient, modelId);
      onSaved();
    } catch (e) {
      setStatus('renaming');
      setSubmitError(e instanceof Error ? e.message : 'Could not rename.');
    }
  }, [value, element, facts, modelId, orgId, userId, branch, expectedHeadCommitId, onSaved, queryClient]);

  return { status, value, submitError, startRenaming, cancelRenaming, setValue, save };
}
