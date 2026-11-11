/**
 * `element_links` (ADR-030): labelled document links on an element. Pointers
 * only — Atlas never stores documents. Thin typed wrapper over the table;
 * validation lives in `src/contracts/elementLink.ts`.
 */
import type { UUID } from '../contracts/delta';
import { validateElementLink } from '../contracts/elementLink';
import type { ElementLinkRow } from '../contracts/rows';
import { assertRealId } from './assertRealId';
import type { Client } from './client';

/** One element's links, oldest first. */
export async function listElementLinks(supabase: Client, modelId: UUID, elementId: UUID): Promise<ElementLinkRow[]> {
  assertRealId('listElementLinks', 'model_id', modelId);
  assertRealId('listElementLinks', 'element_id', elementId);
  const { data, error } = await supabase.from('element_links').select('*').eq('model_id', modelId).eq('element_id', elementId).order('added_at', { ascending: true });
  if (error) throw new Error(`listElementLinks: ${error.message}`);
  return data as ElementLinkRow[];
}

/** Every link on a model, oldest first — callers group client-side, never through an `.in()` (CLAUDE.md rule 8). */
export async function listElementLinksForModel(supabase: Client, modelId: UUID): Promise<ElementLinkRow[]> {
  assertRealId('listElementLinksForModel', 'model_id', modelId);
  const { data, error } = await supabase.from('element_links').select('*').eq('model_id', modelId).order('added_at', { ascending: true });
  if (error) throw new Error(`listElementLinksForModel: ${error.message}`);
  return data as ElementLinkRow[];
}

export interface CreateElementLinkInput {
  /** Minted by the caller (S-1). */
  id: UUID;
  orgId: UUID;
  modelId: UUID;
  elementId: UUID;
  label: string;
  pointer: string;
  addedBy: UUID;
}

export async function createElementLink(supabase: Client, input: CreateElementLinkInput): Promise<ElementLinkRow> {
  const checked = validateElementLink(input);
  if (!checked.ok) throw new Error(`createElementLink: ${checked.error}`);
  const row = { id: input.id, org_id: input.orgId, model_id: input.modelId, element_id: input.elementId, ...checked.value, added_by: input.addedBy };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.from('element_links').insert(row).select('*').single();
  if (error) throw new Error(`createElementLink: ${error.message}`);
  return data as ElementLinkRow;
}

export async function updateElementLink(supabase: Client, input: { id: UUID; label: string; pointer: string; updatedBy: UUID; now: string }): Promise<ElementLinkRow> {
  assertRealId('updateElementLink', 'id', input.id);
  const checked = validateElementLink(input);
  if (!checked.ok) throw new Error(`updateElementLink: ${checked.error}`);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.from('element_links').update({ ...checked.value, updated_by: input.updatedBy, updated_at: input.now }).eq('id', input.id).select('*').single();
  if (error) throw new Error(`updateElementLink: ${error.message}`);
  return data as ElementLinkRow;
}

export async function deleteElementLink(supabase: Client, id: UUID): Promise<void> {
  assertRealId('deleteElementLink', 'id', id);
  const { error } = await supabase.from('element_links').delete().eq('id', id);
  if (error) throw new Error(`deleteElementLink: ${error.message}`);
}
