import { useQuery } from '@tanstack/react-query';
import { listOptionSources } from '../../db/productCatalogue';
import { supabase } from '../supabaseClient';
import type { OptionSource } from '../../contracts/optionSource';

/** The catalogue citations saved with this decision's options. Read once per page; the rows are append-only. */
export function useOptionSources(decisionId: string) {
  return useQuery({
    queryKey: ['optionSources', decisionId],
    queryFn: (): Promise<OptionSource[]> => listOptionSources(supabase, decisionId),
    staleTime: 60_000,
  });
}
