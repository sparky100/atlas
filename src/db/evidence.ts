/**
 * `evidence` (ADR-013): a document, link or reference cited in support of
 * a decision or a project. F10 step 5 adds the first authoring path — a
 * link or document reference attached to a project (ADR-024
 * `project_links`), closing part of ADR-022's deferred row.
 */
import { assertRealId } from './assertRealId';
import type { Client } from './client';
import type { EvidenceKind, EvidenceRow } from './types';
import type { UUID } from '../contracts/delta';

/** Every evidence row on a model, oldest first — callers narrow to the ids they hold client-side, never through an `.in()` over a growing list (CLAUDE.md rule 8). */
export async function listEvidenceForModel(supabase: Client, modelId: UUID): Promise<EvidenceRow[]> {
  assertRealId('listEvidenceForModel', 'model_id', modelId);
  const { data, error } = await supabase.from('evidence').select('*').eq('model_id', modelId).order('added_at', { ascending: true });
  if (error) throw new Error(`listEvidenceForModel: ${error.message}`);
  return data as EvidenceRow[];
}

export interface CreateEvidenceInput {
  /** Minted by the caller (S-1). */
  id: UUID;
  orgId: UUID;
  modelId: UUID;
  /** Authoring offers `link` and `document` only; `capture_job_ref`/`comment_ref` are written by their own flows. */
  kind: Extract<EvidenceKind, 'link' | 'document'>;
  pointer: string;
  description: string | null;
  addedBy: UUID;
}

export async function createEvidence(supabase: Client, input: CreateEvidenceInput): Promise<EvidenceRow> {
  const row = { id: input.id, org_id: input.orgId, model_id: input.modelId, kind: input.kind, pointer: input.pointer, description: input.description, added_by: input.addedBy };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.from('evidence').insert(row).select('*').single();
  if (error) throw new Error(`createEvidence: ${error.message}`);
  return data as EvidenceRow;
}
