import { useCallback, useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { getMainBranch } from '../../db/branches';
import { createTag, listTagsForModel } from '../../db/tags';
import type { TagRow } from '../../db/types';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';

export type VersionsStatus = 'loading' | 'idle' | 'tagging';

export interface UseVersionsResult {
  status: VersionsStatus;
  tags: TagRow[];
  error: string | null;
  /** `null` while a model has no commits yet — there is nothing to tag. */
  mainHeadCommitId: UUID | null;
  /** Tags `mainHeadCommitId` (SPEC §5.1's "tag main at a commit") — always the *current* head, never an arbitrary historical one; see src/db/tags.ts's own comment on why that's the only case worth building here. */
  createVersion: (name: string, note: string) => Promise<void>;
  reload: () => void;
}

/**
 * Sprint U2 step 4's "version list" — every tag on this model, and the
 * "tag main" action itself. `createTag` (src/db/tags.ts) does the real
 * work (role gate via RLS, `atlas.guard_tag_on_main`, and the fold-from-
 * genesis integrity check SPEC §6.6 requires before a tag is ever
 * created); this hook is just the loading/error/reload plumbing around it.
 */
export function useVersions(modelId: UUID, orgId: UUID, userId: UUID | null): UseVersionsResult {
  const [status, setStatus] = useState<VersionsStatus>('loading');
  const [tags, setTags] = useState<TagRow[]>([]);
  const [mainHeadCommitId, setMainHeadCommitId] = useState<UUID | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    Promise.all([listTagsForModel(supabase, modelId), getMainBranch(supabase, modelId)])
      .then(([tagRows, main]) => {
        if (cancelled) return;
        setTags([...tagRows].sort((a, b) => b.created_at.localeCompare(a.created_at)));
        setMainHeadCommitId(main?.head_commit_id ?? null);
        setStatus('idle');
      })
      .catch((e: unknown) => {
        reportError("Couldn't load versions.", e);
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load versions.');
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

  const createVersion = useCallback(
    async (name: string, note: string) => {
      if (!userId) {
        setError('You must be signed in to tag a version.');
        return;
      }
      const trimmedName = name.trim();
      if (trimmedName.length === 0) {
        setError('Version name cannot be empty.');
        return;
      }
      if (!mainHeadCommitId) {
        setError('This model has no commits yet — there is nothing to tag.');
        return;
      }
      setError(null);
      setStatus('tagging');

      try {
        await createTag(supabase, {
          id: crypto.randomUUID(),
          orgId,
          modelId,
          name: trimmedName,
          commitId: mainHeadCommitId,
          ...(note.trim().length > 0 ? { description: note.trim() } : {}),
          createdBy: userId,
        });
        setStatus('idle');
        reload();
      } catch (e) {
        setStatus('idle');
        setError(e instanceof Error ? e.message : 'Could not create this version.');
      }
    },
    [modelId, orgId, userId, mainHeadCommitId, reload],
  );

  return { status, tags, error, mainHeadCommitId, createVersion, reload };
}
