/**
 * Sample models (docs/ADR-033). Same division of labour as `copyModel.ts`:
 * this reads and writes and `src/engine/sampleModel.ts` builds. There is no
 * new database function: "platform admin only" is `sample_models_insert`'s
 * row-level security, and "owner or architect of this organisation" is the
 * existing `models_insert` policy and `atlas.commit_deltas`'s own role check —
 * enforced there, not here and not in the UI.
 */
import type { UUID } from '../contracts/delta';
import { parseSamplePayload, SAMPLE_SLUG_PATTERN, type SampleModelSummary } from '../contracts/sampleModel';
import { buildSamplePayload, planSampleCopy } from '../engine/sampleModel';
import { getMainBranch } from './branches';
import type { Client } from './client';
import { commitToBranch } from './commits';
import { createModel } from './models';
import { selectAll } from './selectAll';
import { listSourcesForModel } from './sources';
import { loadMaterialisedHead } from './tags';
import type { AliasRow, ModelRow } from './types';

/** The newest published version of each sample, for the "start with a sample" offer. The payload is not read here. */
export async function listSampleModels(supabase: Client): Promise<SampleModelSummary[]> {
  const { data, error } = await supabase.from('sample_models').select('id, slug, version, name, description').order('version', { ascending: false });
  if (error) throw new Error(`listSampleModels: ${error.message}`);
  const rows = data as SampleModelSummary[];
  const seen = new Set<string>();
  const newest: SampleModelSummary[] = [];
  for (const row of rows) {
    if (seen.has(row.slug)) continue;
    seen.add(row.slug);
    newest.push(row);
  }
  return newest.sort((a, b) => a.name.localeCompare(b.name));
}

export interface PublishSampleInput {
  source: ModelRow;
  slug: string;
}

export type PublishSampleResult = { ok: true; version: number; elements: number; relationships: number } | { ok: false; message: string };

/** Platform admin only: publishing is a plain insert of the next version of `slug`, which only `sample_models_insert`'s row-level security lets a platform admin do (`atlas`'s own function is not involved). */
export async function publishSampleModel(supabase: Client, input: PublishSampleInput, publishedBy: UUID): Promise<PublishSampleResult> {
  const { source } = input;
  const slug = input.slug.trim();
  if (!SAMPLE_SLUG_PATTERN.test(slug)) return { ok: false, message: 'Use lowercase letters, numbers and single hyphens for the sample’s short name.' };
  const main = await getMainBranch(supabase, source.id);
  if (!main) return { ok: false, message: 'This model has no main branch to publish.' };
  const head = await loadMaterialisedHead(supabase, main.head_commit_id);
  if (head.elements.size === 0) return { ok: false, message: 'There is nothing in this model to publish yet.' };

  const sources = await listSourcesForModel(supabase, source.id);
  const aliases = await selectAll<Pick<AliasRow, 'element_id' | 'alias_value' | 'alias_type' | 'source_id' | 'confidence'>>(
    supabase.from('aliases').select('element_id, alias_value, alias_type, source_id, confidence', { count: 'exact' }).eq('model_id', source.id).order('id'),
  );
  const payload = buildSamplePayload(head, sources, aliases);

  const { data: latest, error: latestError } = await supabase.from('sample_models').select('version').eq('slug', slug).order('version', { ascending: false }).limit(1);
  if (latestError) return { ok: false, message: latestError.message };
  const version = ((latest as { version: number }[]).at(0)?.version ?? 0) + 1;

  const { error } = await supabase.from('sample_models').insert({ slug, version, name: source.name, description: source.description, payload, published_by: publishedBy });
  if (error) {
    if (error.code === '23505') return { ok: false, message: 'Someone published this sample at the same moment — try again.' };
    if (error.code === '42501') return { ok: false, message: 'Only a platform admin can publish a sample.' };
    return { ok: false, message: error.message };
  }
  return { ok: true, version, elements: payload.elementsHead.length, relationships: payload.relationshipsHead.length };
}

export interface CopySampleInput {
  sample: SampleModelSummary;
  orgId: UUID;
  name: string;
  slug: string;
  authorId: UUID;
}

export type CopySampleResult = { ok: true; model: ModelRow; copiedElements: number; copiedRelationships: number } | { ok: false; message: string };

/**
 * Copies a published sample into a new model in `orgId`. No new database
 * function: this reuses four ordinary paths, each under the caller's own
 * row-level security — create the model (owner or architect, `models_insert`),
 * add its sources (`sources_insert`), commit the sample's deltas to its main
 * branch (`atlas.commit_deltas`, which checks the caller's role itself), and
 * add its aliases (`aliases_insert`). They are separate calls, not one
 * transaction: if one fails after the model exists, the model is left
 * partly filled and the message says so, so its owner can delete it.
 */
export async function copySampleModel(supabase: Client, input: CopySampleInput): Promise<CopySampleResult> {
  const { sample, orgId, name, slug, authorId } = input;
  const { data: row, error: readError } = await supabase.from('sample_models').select('payload').eq('id', sample.id).maybeSingle();
  if (readError) return { ok: false, message: readError.message };
  if (!row) return { ok: false, message: 'That sample is no longer available.' };
  const payload = parseSamplePayload(row.payload);

  const copy = planSampleCopy(payload, authorId, new Date().toISOString(), () => crypto.randomUUID());

  let model: ModelRow;
  try {
    model = await createModel(supabase, { id: crypto.randomUUID(), orgId, name, slug, ...(sample.description !== null ? { description: sample.description } : {}), createdBy: authorId });
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Could not create the model.' };
  }
  const partial = (what: string, message: string): CopySampleResult => ({ ok: false, message: `${what} The new model “${name}” was created but is not complete — you can delete it in its settings and try again. (${message})` });

  const sourceRows = copy.sources.map((source) => ({ id: source.id, org_id: orgId, model_id: model.id, kind: source.kind, name: source.name, uri: null, captured_at: source.captured_at, created_by: authorId }));
  const { error: sourceError } = await supabase.from('sources').insert(sourceRows);
  if (sourceError) return partial('Could not add the sample’s sources.', sourceError.message);

  const main = await getMainBranch(supabase, model.id);
  if (!main) return partial('The new model has no main branch.', 'main branch missing');
  const committed = await commitToBranch(supabase, {
    modelId: model.id,
    branchId: main.id,
    expectedHeadCommitId: main.head_commit_id,
    envelope: { id: crypto.randomUUID(), branchId: main.id, parentCommitId: main.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: `Copied from the ${sample.name} sample`, body: null, deltas: copy.deltas },
  });
  if (!committed.ok) return partial('Could not add the sample’s content.', committed.message);

  if (copy.aliases.length > 0) {
    const aliasRows = copy.aliases.map((alias) => ({ id: crypto.randomUUID(), org_id: orgId, model_id: model.id, element_id: alias.element_id, alias_value: alias.alias_value, alias_type: alias.alias_type, source_id: alias.source_id, confidence: alias.confidence, created_by: authorId }));
    const { error: aliasError } = await supabase.from('aliases').insert(aliasRows);
    if (aliasError) return partial('Could not add the sample’s names and codes.', aliasError.message);
  }

  return { ok: true, model, copiedElements: copy.elementCount, copiedRelationships: copy.relationshipCount };
}
