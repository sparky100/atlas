/**
 * Reads for the starter capability maps (SPEC §3.10, ADR-012) — product
 * content, no org_id, readable by every authenticated user
 * (supabase/migrations/20260906110000_capability_map_templates.sql).
 * Writing these tables is scripts/loadCapabilityMaps.ts's job, as
 * service_role; nothing here ever inserts/updates/deletes them.
 */
import type { UUID } from '../contracts/delta';
import type { Client } from './client';

export type MapStatus = 'draft' | 'published' | 'deprecated';

export interface CapabilityMapRow {
  id: UUID;
  sector: string;
  version: number;
  status: MapStatus;
  source_description: string;
  published_at: string | null;
  created_at: string;
}

export interface CapabilityMapItemRow {
  id: UUID;
  map_id: UUID;
  code: string;
  parent_code: string | null;
  name: string;
  description: string | null;
  level: number;
}

/** Every published starter map — the tailoring flow's import picker only ever offers these (a draft map is real schema, reviewable, but not yet meant for anyone to seed a model from). */
export async function listPublishedCapabilityMaps(supabase: Client): Promise<CapabilityMapRow[]> {
  const { data, error } = await supabase.from('capability_maps').select('*').eq('status', 'published').order('sector').order('version', { ascending: false });
  if (error) throw new Error(`listPublishedCapabilityMaps: ${error.message}`);
  return data as CapabilityMapRow[];
}

export async function getCapabilityMap(supabase: Client, mapId: UUID): Promise<CapabilityMapRow | null> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.from('capability_maps').select('*').eq('id', mapId).maybeSingle();
  if (error) throw new Error(`getCapabilityMap: ${error.message}`);
  return data as CapabilityMapRow | null;
}

export async function listCapabilityMapItems(supabase: Client, mapId: UUID): Promise<CapabilityMapItemRow[]> {
  const { data, error } = await supabase.from('capability_map_items').select('*').eq('map_id', mapId).order('level');
  if (error) throw new Error(`listCapabilityMapItems: ${error.message}`);
  return data as CapabilityMapItemRow[];
}
