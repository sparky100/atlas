import { useCallback, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { archiveModel, deleteModel, restoreModel, updateModel, type DeleteModelResult, type UpdateModelInput } from '../../db/models';
import type { ModelRow } from '../../db/types';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';

export type ModelSettingsStatus = 'idle' | 'saving';

export interface UseModelSettingsResult {
  status: ModelSettingsStatus;
  error: string | null;
  update: (input: UpdateModelInput) => Promise<ModelRow | null>;
  archive: () => Promise<ModelRow | null>;
  restore: () => Promise<ModelRow | null>;
  /** `null` on a real failure (already reported); the result's own `status` distinguishes 'deleted' from the two refused outcomes ('not_archived'/'not_found') a caller shows inline rather than as a global error. */
  remove: () => Promise<DeleteModelResult | null>;
}

/**
 * Sprint 7j item 1: model settings' rename/Archive/Restore/Delete — one
 * status/error pair around the four `db/models.ts` mutations, the same
 * shape `useElementRetire.ts`/`useElementRename.ts` already use for a
 * single-purpose write hook. `onChanged` re-fetches the caller's own model
 * row rather than this hook keeping its own copy — `ModelSettingsView.tsx`
 * already has one from its route.
 */
export function useModelSettings(modelId: UUID, onChanged: (model: ModelRow) => void): UseModelSettingsResult {
  const [status, setStatus] = useState<ModelSettingsStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async <T,>(label: string, action: () => Promise<T>, apply: (result: T) => void): Promise<T | null> => {
      setError(null);
      setStatus('saving');
      try {
        const result = await action();
        apply(result);
        setStatus('idle');
        return result;
      } catch (e) {
        setStatus('idle');
        const message = e instanceof Error ? e.message : `Could not ${label}.`;
        setError(message);
        reportError(`Could not ${label}: ${message}`);
        return null;
      }
    },
    [],
  );

  const update = useCallback((input: UpdateModelInput) => run('rename this model', () => updateModel(supabase, modelId, input), onChanged), [modelId, onChanged, run]);
  const archive = useCallback(() => run('archive this model', () => archiveModel(supabase, modelId), onChanged), [modelId, onChanged, run]);
  const restore = useCallback(() => run('restore this model', () => restoreModel(supabase, modelId), onChanged), [modelId, onChanged, run]);
  const remove = useCallback(
    () =>
      run(
        'delete this model',
        () => deleteModel(supabase, modelId),
        () => {
          // Nothing to re-fetch on success — the model itself is gone; a
          // 'not_archived'/'not_found' result isn't a model to re-apply
          // either, it's shown inline by the caller instead.
        },
      ),
    [modelId, run],
  );

  return { status, error, update, archive, restore, remove };
}
