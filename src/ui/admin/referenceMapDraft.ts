import type { CapabilityMapContent } from '../../contracts/capabilityMapContent';
import { copyReferenceMap, type ReferenceMapSummary } from '../../db/referenceMapAdmin';
import { supabase } from '../supabaseClient';

/**
 * The starting content for a new draft: a copy of the base map when there is
 * one, otherwise an empty set. The caller supplies the next version so the
 * copied content and the draft row agree.
 */
export async function contentForNewDraft(
  sector: string,
  version: number,
  base: ReferenceMapSummary | null,
): Promise<CapabilityMapContent> {
  if (base !== null) return { ...(await copyReferenceMap(supabase, base)), version };
  return {
    sector: sector as CapabilityMapContent['sector'],
    version,
    status: 'draft',
    title: '',
    summary: '',
    sourceDescription: '',
    sources: [],
    items: [],
    valueStreams: [],
  };
}
