import { capabilityMapContentSchema, type CapabilityMapContent } from '../contracts/capabilityMapContent';
import { referenceMapDraftRowSchema } from '../contracts/referenceMapAdmin';
import type { Client } from './client';

export interface ReferenceMapDraft {
  id: string;
  sector: string;
  version: number;
  base_map_id: string | null;
  content: CapabilityMapContent;
  edit_revision: number;
  status: 'draft' | 'published';
  published_map_id: string | null;
  updated_at: string;
}

export interface ReferenceMapSummary {
  id: string;
  sector: string;
  version: number;
  status: string;
  title: string | null;
  published_at: string | null;
  item_count: number;
  seeded_model_count: number;
}

export interface DraftAlignment {
  item_code: string;
  kind: 'existing' | 'new';
  capability_id: string | null;
  capability_revision: number | null;
  stable_key: string | null;
  reviewed_name: string;
  reviewed_description: string;
  review_basis: string;
}

export interface CanonicalCapabilityMatch {
  capability_id: string;
  revision: number;
  name: string;
  definition: string;
  stable_key: string;
}

export async function listDraftAlignments(client: Client, draftId: string): Promise<DraftAlignment[]> {
  const { data, error } = await client.from('reference_map_draft_alignments')
    .select('item_code,kind,capability_id,capability_revision,stable_key,reviewed_name,reviewed_description,review_basis')
    .eq('draft_id', draftId);
  if (error) throw new Error(error.message);
  return data;
}

export async function searchCanonicalCapabilities(client: Client, query: string): Promise<CanonicalCapabilityMatch[]> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- the project client has untyped RPC results.
  const { data, error } = await client.schema('atlas').rpc('search_reference_capabilities', { p_query: query });
  if (error) throw new Error(error.message);
  return data as CanonicalCapabilityMatch[];
}

export async function alignDraftItem(client: Client, draft: ReferenceMapDraft, code: string,
  choice: { kind: 'existing'; capabilityId: string; revision: number; reviewBasis: string }
    | { kind: 'new'; stableKey: string; definition: string; reviewBasis: string }): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- the project client has untyped RPC results.
  const { data, error } = await client.schema('atlas').rpc('align_reference_map_draft_item', {
    p_id: draft.id, p_expected_revision: draft.edit_revision, p_code: code, p_choice: choice,
  });
  if (error) throw new Error(error.message);
  return data as number;
}

export async function listReferenceMaps(client: Client): Promise<{ maps: ReferenceMapSummary[]; drafts: ReferenceMapDraft[] }> {
  const [maps, drafts] = await Promise.all([
    client.schema('atlas').rpc('reference_map_inventory'),
    client.from('reference_map_drafts').select('id,sector,version,base_map_id,content,edit_revision,status,published_map_id,updated_at').order('updated_at', { ascending: false }),
  ]);
  if (maps.error) throw new Error(maps.error.message);
  if (drafts.error) throw new Error(drafts.error.message);
  const draftRows = (drafts.data as unknown[]).map((row) => {
    const parsed = referenceMapDraftRowSchema.parse(row);
    return { ...parsed, content: parsed.content as unknown as CapabilityMapContent };
  });
  return { maps: maps.data as ReferenceMapSummary[], drafts: draftRows };
}

/** Rebuilds the existing published snapshot for editing; the public version is never updated. */
export async function copyReferenceMap(client: Client, map: ReferenceMapSummary): Promise<CapabilityMapContent> {
  const [meta, items, sources, streamItems, enables] = await Promise.all([
    client.from('capability_maps').select('source_description,summary,title').eq('id', map.id).single(),
    client.from('capability_map_items').select('code,parent_code,name,description,level,item_order').eq('map_id', map.id).order('level').order('item_order'),
    client.from('capability_map_sources').select('citation,url,reviewed_by,reviewed_at').eq('map_id', map.id),
    client.from('capability_map_value_stream_items').select('code,parent_code,name,description,item_order').eq('map_id', map.id).order('item_order'),
    client.from('capability_map_value_stream_enables').select('stage_code,capability_code').eq('map_id', map.id),
  ]);
  for (const result of [meta, items, sources, streamItems, enables]) if (result.error) throw new Error(result.error.message);
  const itemRows = items.data as { code: string; parent_code: string | null; name: string; description: string | null; level: number; item_order: number }[];
  const stageRows = streamItems.data as { code: string; parent_code: string | null; name: string; description: string | null; item_order: number }[];
  const edges = enables.data as { stage_code: string; capability_code: string }[];
  const byCode = new Map(itemRows.map((item) => [item.code, item.name]));
  const content = {
    sector: map.sector, version: map.version + 1, status: 'draft',
    title: (meta.data as { title: string | null }).title ?? map.sector,
    summary: (meta.data as { summary: string | null }).summary ?? '',
    sourceDescription: (meta.data as { source_description: string }).source_description,
    items: itemRows.map((item) => ({ code: item.code, name: item.name, description: item.description ?? '', level: item.level, parentCode: item.parent_code, order: item.item_order })),
    sources: (sources.data as { citation: string; url: string | null; reviewed_by: string; reviewed_at: string }[]).map((s) => ({ citation: s.citation, url: s.url ?? '', reviewedBy: s.reviewed_by, reviewedAt: s.reviewed_at })),
    valueStreams: stageRows.filter((s) => s.parent_code === null).map((stream) => ({
      code: stream.code, name: stream.name, description: stream.description ?? '', order: stream.item_order,
      stages: stageRows.filter((stage) => stage.parent_code === stream.code).map((stage) => ({
        code: stage.code, name: stage.name, description: stage.description ?? '', order: stage.item_order,
        enables: edges.filter((edge) => edge.stage_code === stage.code).map((edge) => byCode.get(edge.capability_code) ?? '').filter(Boolean),
      })),
    })),
  };
  const parsed = capabilityMapContentSchema.safeParse(content);
  if (!parsed.success) throw new Error(`The published map could not be copied: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`);
  return parsed.data;
}

export async function createReferenceMapDraft(client: Client, sector: string, version: number, baseMapId: string | null, content: CapabilityMapContent): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- the project client has untyped RPC results.
  const { data, error } = await client.schema('atlas').rpc('create_reference_map_draft', { p_sector: sector, p_version: version, p_base_map_id: baseMapId, p_content: content });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function saveReferenceMapDraft(client: Client, draft: ReferenceMapDraft, content: CapabilityMapContent): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- the project client has untyped RPC results.
  const { data, error } = await client.schema('atlas').rpc('save_reference_map_draft', { p_id: draft.id, p_expected_revision: draft.edit_revision, p_content: content });
  if (error) throw new Error(error.message);
  return data as number;
}

export async function validateReferenceMap(client: Client, content: CapabilityMapContent): Promise<string[]> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- the project client has untyped RPC results.
  const { data, error } = await client.schema('atlas').rpc('reference_map_issues', { p_content: content });
  if (error) throw new Error(error.message);
  return data as string[];
}

export async function publishReferenceMapDraft(client: Client, draft: ReferenceMapDraft): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- the project client has untyped RPC results.
  const { data, error } = await client.schema('atlas').rpc('publish_reference_map_draft', { p_id: draft.id, p_expected_revision: draft.edit_revision });
  if (error) throw new Error(error.message);
  return data as string;
}
