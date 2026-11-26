import { useQuery } from '@tanstack/react-query';
import type { UUID } from '../../contracts/delta';
import { loadSearchPoolForTypes } from '../../db/elementSearch';
import { useMainBranch } from '../branches/useMainBranch';
import { supabase } from '../supabaseClient';
import type { ModelElementName } from './productInModel';

/**
 * The systems and modules in the model's current main, for recognising a listed
 * product that is already modelled. Read-only; a failed read just means no note is shown.
 */
export function useModelElementNames(modelId: UUID | null): ModelElementName[] {
  const { branch } = useMainBranch(modelId);
  const commitId = branch?.head_commit_id ?? null;
  const { data } = useQuery({
    queryKey: ['modelElementNames', modelId, commitId],
    enabled: modelId !== null && commitId !== null,
    queryFn: async (): Promise<ModelElementName[]> => {
      if (modelId === null || commitId === null) return [];
      const pool = await loadSearchPoolForTypes(supabase, commitId, modelId, ['system', 'container']);
      const byId = new Map(pool.map((p) => [p.element.element_id, p.element]));
      return pool.flatMap(({ element }): ModelElementName[] => {
        if (element.element_type !== 'system' && element.element_type !== 'container') return [];
        const parent = element.parent_id === null ? undefined : byId.get(element.parent_id);
        return [{ id: element.element_id, name: element.name, type: element.element_type, platformName: parent?.name ?? null }];
      });
    },
    staleTime: 60_000,
  });
  return data ?? [];
}
