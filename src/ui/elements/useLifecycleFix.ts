import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import type { ElementsHeadRow } from '../../contracts/rows';
import type { BranchRow } from '../../db/types';
import { applyCommitToCache } from '../query/applyCommitToCache';
import { supabase } from '../supabaseClient';
import { reportToast } from '../toasts/toastStore';
import { commitBulkEdit } from './bulkEdit';

export interface UseLifecycleFixInput {
  modelId: UUID;
  orgId: UUID;
  userId: UUID | null;
  /** The branch the fix writes to — main, or the draft change being edited; `null` until it has loaded. */
  branch: BranchRow | null;
  onFixed: () => void;
}

export interface LifecycleFixController {
  /** The element currently being fixed, if any — one at a time. */
  fixingId: UUID | null;
  error: string | null;
  fix: (element: ElementsHeadRow, status: 'planned' | 'active' | 'retired') => Promise<void>;
}

/**
 * The "Set to planned / active / retired" button on a status-and-dates
 * mismatch row: one ordinary manual edit of the element's own lifecycle
 * status (`commitBulkEdit`, so the same provenance and validation as the
 * grid's own edit), never a write to the head tables directly.
 */
export function useLifecycleFix({ modelId, orgId, userId, branch, onFixed }: UseLifecycleFixInput): LifecycleFixController {
  const [fixingId, setFixingId] = useState<UUID | null>(null);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const fix = useCallback(
    async (element: ElementsHeadRow, status: 'planned' | 'active' | 'retired') => {
      if (!userId || !branch) {
        setError(!userId ? 'You must be signed in to edit.' : 'Still loading — try again in a moment.');
        return;
      }
      setFixingId(element.element_id);
      setError(null);
      try {
        const result = await commitBulkEdit(supabase, {
          modelId,
          orgId,
          userId,
          branch,
          expectedHeadCommitId: branch.head_commit_id,
          cells: [{ elementId: element.element_id, key: 'lifecycleStatus', draft: status }],
          elementsById: new Map([[element.element_id, element]]),
          customFields: new Map(),
        });
        if (!result.ok) {
          if (result.reason === 'validation') setError([...result.errors.values()][0] ?? 'Could not save.');
          else setError(result.reason === 'conflict' ? 'The model changed since you loaded this page. Reload and try again.' : `Could not save: ${result.message}`);
          return;
        }
        if (result.commitId !== null) {
          applyCommitToCache(queryClient, modelId, branch, result.commitId, result.newHead);
          reportToast(branch.kind === 'change' ? `Set ${element.name} to ${status}, in change: ${branch.title ?? branch.name}` : `Set ${element.name} to ${status}`);
        }
        onFixed();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not save.');
      } finally {
        setFixingId(null);
      }
    },
    [modelId, orgId, userId, branch, queryClient, onFixed],
  );

  return { fixingId, error, fix };
}
