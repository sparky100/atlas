/**
 * Starter sets of principles (docs/ADR-034). Same division of labour as
 * `sampleModels.ts`: this reads and writes, `src/engine/principleSet.ts`
 * builds and plans. There is no database function: "platform admin only" is
 * `principle_sets_insert`'s row-level security, and "owner or architect of
 * this organisation" is the existing `principles_insert` policy — enforced
 * there, not here and not in the UI.
 */
import type { UUID } from '../contracts/delta';
import { parsePrincipleSetPayload, PRINCIPLE_SET_SLUG_PATTERN, type PrincipleSetPayload, type PrincipleSetSummary } from '../contracts/principleSet';
import { buildPrincipleSetPayload, planPrincipleSetCopy } from '../engine/principleSet';
import type { Client } from './client';
import { listPrinciplesForModel } from './principles';

/** The newest published version of each set. The payload is not read here. */
export async function listPrincipleSets(supabase: Client): Promise<PrincipleSetSummary[]> {
  const { data, error } = await supabase.from('principle_sets').select('id, slug, version, name, description').order('version', { ascending: false });
  if (error) throw new Error(`listPrincipleSets: ${error.message}`);
  const rows = data as PrincipleSetSummary[];
  const seen = new Set<string>();
  const newest: PrincipleSetSummary[] = [];
  for (const row of rows) {
    if (seen.has(row.slug)) continue;
    seen.add(row.slug);
    newest.push(row);
  }
  return newest.sort((a, b) => a.name.localeCompare(b.name));
}

/** The principles in one published version of a set, in the order the set lists them. */
export async function readPrincipleSet(supabase: Client, setId: UUID): Promise<PrincipleSetPayload> {
  const { data, error } = await supabase.from('principle_sets').select('payload').eq('id', setId).maybeSingle();
  if (error) throw new Error(`readPrincipleSet: ${error.message}`);
  if (!data) throw new Error('readPrincipleSet: that set is no longer available');
  return parsePrincipleSetPayload(data.payload);
}

export interface PublishPrincipleSetInput {
  modelId: UUID;
  slug: string;
  name: string;
  description: string;
}

export type PublishPrincipleSetResult = { ok: true; version: number; principles: number } | { ok: false; message: string };

/** Platform admin only: publishing is a plain insert of the next version of `slug`, which only `principle_sets_insert`'s row-level security lets a platform admin do. Publishes the model's active principles. */
export async function publishPrincipleSet(supabase: Client, input: PublishPrincipleSetInput, publishedBy: UUID): Promise<PublishPrincipleSetResult> {
  const slug = input.slug.trim();
  const name = input.name.trim();
  if (!PRINCIPLE_SET_SLUG_PATTERN.test(slug) || slug.length > 60) return { ok: false, message: 'Use lowercase letters, numbers and single hyphens for the set’s short name (60 characters at most).' };
  if (name === '' || name.length > 120) return { ok: false, message: 'Give the set a name (120 characters at most).' };
  const description = input.description.trim();
  if (description.length > 500) return { ok: false, message: 'The description is too long (500 characters at most).' };

  const payload = buildPrincipleSetPayload(await listPrinciplesForModel(supabase, input.modelId));
  if (payload.principles.length === 0) return { ok: false, message: 'There are no active principles in this model to publish.' };

  const { data: latest, error: latestError } = await supabase.from('principle_sets').select('version').eq('slug', slug).order('version', { ascending: false }).limit(1);
  if (latestError) return { ok: false, message: latestError.message };
  const version = ((latest as { version: number }[]).at(0)?.version ?? 0) + 1;

  const { error } = await supabase.from('principle_sets').insert({ slug, version, name, description: description === '' ? null : description, payload, published_by: publishedBy });
  if (error) {
    if (error.code === '23505') return { ok: false, message: 'Someone published this set at the same moment — try again.' };
    if (error.code === '42501') return { ok: false, message: 'Only a platform admin can publish a set.' };
    return { ok: false, message: error.message };
  }
  return { ok: true, version, principles: payload.principles.length };
}

export interface AddFromSetInput {
  set: PrincipleSetSummary;
  /** Positions in the set's principle list that the person ticked. */
  picked: readonly number[];
  orgId: UUID;
  modelId: UUID;
  createdBy: UUID;
}

export type AddFromSetResult = { ok: true; added: number; alreadyThere: string[] } | { ok: false; message: string };

/**
 * Adds the ticked principles to the model as its own, one `principles` insert
 * (so all or none), each under `principles_insert` (owner or architect). Titles
 * the model already has are skipped. Nothing is added unless picked.
 */
export async function addPrinciplesFromSet(supabase: Client, input: AddFromSetInput): Promise<AddFromSetResult> {
  let payload: PrincipleSetPayload;
  try {
    payload = await readPrincipleSet(supabase, input.set.id);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'That set is no longer available.' };
  }
  const existing = await listPrinciplesForModel(supabase, input.modelId);
  const plan = planPrincipleSetCopy(payload, { slug: input.set.slug, name: input.set.name, version: input.set.version }, input.picked, existing.map((p) => p.title), () => crypto.randomUUID());
  if (plan.rows.length > 0) {
    const rows = plan.rows.map((r) => ({ ...r, org_id: input.orgId, model_id: input.modelId, created_by: input.createdBy }));
    const { error } = await supabase.from('principles').insert(rows);
    if (error) return { ok: false, message: error.code === '42501' ? 'Only an owner or architect can add principles.' : error.message };
  }
  return { ok: true, added: plan.rows.length, alreadyThere: plan.alreadyThere };
}
