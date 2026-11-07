/**
 * ADR-029 §1: `atlas_list_models`. Reads the models the signed-in user can
 * see (row-level security decides which) with their organisation, paged
 * past the row cap (rule 8's neighbour, SPEC §6.7) and without any
 * caller-supplied id list.
 */
import type { Client } from '../../src/db/client';
import { selectAll } from '../../src/db/selectAll';

export interface VisibleModel {
  modelId: string;
  name: string;
  slug: string;
  organisation: string;
  organisationSlug: string;
  archived: boolean;
}

export async function listVisibleModels(supabase: Client): Promise<VisibleModel[]> {
  // `id` is unique, so the order is stable across pages.
  const modelsQuery = supabase.from('models').select('id, org_id, name, slug, archived_at', { count: 'exact' }).order('id');
  const orgsQuery = supabase.from('organisations').select('id, name, slug', { count: 'exact' }).order('id');
  const [models, orgs] = await Promise.all([
    selectAll<{ id: string; org_id: string; name: string; slug: string; archived_at: string | null }>(modelsQuery),
    selectAll<{ id: string; name: string; slug: string }>(orgsQuery),
  ]);
  const orgById = new Map(orgs.map((o) => [o.id, o]));
  return models
    .map((m) => ({
      modelId: m.id,
      name: m.name,
      slug: m.slug,
      organisation: orgById.get(m.org_id)?.name ?? 'Unknown organisation',
      organisationSlug: orgById.get(m.org_id)?.slug ?? '',
      archived: m.archived_at !== null,
    }))
    .sort((a, b) => a.organisation.localeCompare(b.organisation) || a.name.localeCompare(b.name));
}
