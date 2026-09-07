import { useCallback, useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { createChangeBranch, getMainBranch, listChangeBranches } from '../../db/branches';
import type { BranchRow } from '../../db/types';
import { supabase } from '../supabaseClient';

export type ChangesStatus = 'loading' | 'idle' | 'creating';

export interface CreateChangeInput {
  name: string;
  title: string;
  description: string;
  /** ISO `date` string (`YYYY-MM-DD`), or `''` for no target date. */
  targetDate: string;
}

export interface UseChangesResult {
  status: ChangesStatus;
  branches: BranchRow[];
  error: string | null;
  /** `null` while the model has no commits yet — there is nothing to fork a change from. */
  mainHeadCommitId: UUID | null;
  createChange: (input: CreateChangeInput) => Promise<BranchRow | null>;
  reload: () => void;
}

/**
 * Sprint C1 step 3's "Changes" list: every `change`-kind branch on this
 * model, and the "create change" action. Mirrors src/ui/versions/useVersions.ts's
 * shape exactly (load/error/reload plumbing around one real create call) —
 * `createChangeBranch` (src/db/branches.ts) does the real work (RLS's role
 * + fork-from-main-head check, `branches_insert`'s WITH CHECK).
 */
export function useChanges(modelId: UUID, orgId: UUID, userId: UUID | null): UseChangesResult {
  const [status, setStatus] = useState<ChangesStatus>('loading');
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [mainHeadCommitId, setMainHeadCommitId] = useState<UUID | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    Promise.all([listChangeBranches(supabase, modelId), getMainBranch(supabase, modelId)])
      .then(([branchRows, main]) => {
        if (cancelled) return;
        setBranches(branchRows);
        setMainHeadCommitId(main?.head_commit_id ?? null);
        setStatus('idle');
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load changes.');
          setStatus('idle');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [modelId, reloadToken]);

  const reload = useCallback(() => {
    setReloadToken((t) => t + 1);
  }, []);

  const createChange = useCallback(
    async (input: CreateChangeInput): Promise<BranchRow | null> => {
      if (!userId) {
        setError('You must be signed in to create a change.');
        return null;
      }
      const trimmedName = input.name.trim();
      if (trimmedName.length === 0) {
        setError('Name cannot be empty.');
        return null;
      }
      if (!mainHeadCommitId) {
        setError('This model has no commits yet — there is nothing to base a change on.');
        return null;
      }
      setError(null);
      setStatus('creating');

      try {
        const branch = await createChangeBranch(supabase, {
          id: crypto.randomUUID(),
          orgId,
          modelId,
          name: trimmedName,
          ...(input.title.trim().length > 0 ? { title: input.title.trim() } : {}),
          ...(input.description.trim().length > 0 ? { description: input.description.trim() } : {}),
          ...(input.targetDate.trim().length > 0 ? { targetDate: input.targetDate.trim() } : {}),
          createdBy: userId,
          mainHeadCommitId,
        });
        setStatus('idle');
        reload();
        return branch;
      } catch (e) {
        setStatus('idle');
        setError(e instanceof Error ? e.message : 'Could not create this change.');
        return null;
      }
    },
    [modelId, orgId, userId, mainHeadCommitId, reload],
  );

  return { status, branches, error, mainHeadCommitId, createChange, reload };
}
