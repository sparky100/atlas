/**
 * Model repository operations. Thin, typed wrappers — see
 * branches.ts/tags.ts's module comment for the untyped-client
 * `eslint-disable` boundary this follows.
 */
import type { Client } from './client';
import type { ModelRow } from './types';
import type { UUID } from '../contracts/delta';

export interface CreateModelInput {
  /** Minted by the caller (S-1) — never generated here. */
  id: UUID;
  orgId: UUID;
  name: string;
  slug: string;
  description?: string;
  createdBy: UUID;
}

export async function createModel(supabase: Client, input: CreateModelInput): Promise<ModelRow> {
  const row = {
    id: input.id,
    org_id: input.orgId,
    name: input.name,
    slug: input.slug,
    description: input.description ?? null,
    // The model's own schema_version, not the delta wire format's — always
    // 1 for a model created today (SPEC §3.2); a template-seeded model may
    // bump this later, which is out of this sprint's scope.
    schema_version: 1,
    created_by: input.createdBy,
  };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see module comment.
  const { data, error } = await supabase.from('models').insert(row).select('*').single();
  if (error) throw new Error(`createModel: ${error.message}`);
  return data as ModelRow;
}

export async function listModelsForOrg(supabase: Client, orgId: UUID): Promise<ModelRow[]> {
  const { data, error } = await supabase.from('models').select('*').eq('org_id', orgId).order('name');
  if (error) throw new Error(`listModelsForOrg: ${error.message}`);
  return data as ModelRow[];
}

export async function getModelBySlug(supabase: Client, orgId: UUID, slug: string): Promise<ModelRow | null> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see module comment.
  const { data, error } = await supabase.from('models').select('*').eq('org_id', orgId).eq('slug', slug).maybeSingle();
  if (error) throw new Error(`getModelBySlug: ${error.message}`);
  return data as ModelRow | null;
}
