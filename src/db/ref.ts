/**
 * Ref resolution (UI-principles.md §2.4's grammar: `main | tag:{name} |
 * branch:{slug} | commit:{id}`). Sprint U1 has no branches in the UI at
 * all, and only `main`'s current head and a tag's commit are ever
 * materialised (elements_head/relationships_head/facts — SPEC §3.5,
 * ADR-015's `atlas.commit_deltas` only materialises `main`) — so this
 * resolves exactly the two ref kinds a page can actually render against
 * for now. `branch:`/`commit:` are real, named grammar this will grow
 * into once branches exist in the UI, not silently dropped.
 */
import { getMainBranch } from './branches';
import type { Client } from './client';
import type { UUID } from '../contracts/delta';

export type Ref = { kind: 'main' } | { kind: 'tag'; name: string };

export function parseRefParam(raw: string | undefined | null): Ref {
  if (!raw || raw === 'main') return { kind: 'main' };
  if (raw.startsWith('tag:')) return { kind: 'tag', name: raw.slice(4) };
  // branch:/commit: aren't reachable yet (no branches in Sprint U1's UI);
  // default to main rather than erroring on a ref this page can't use yet.
  return { kind: 'main' };
}

export function refParamOf(ref: Ref): string {
  return ref.kind === 'main' ? 'main' : `tag:${ref.name}`;
}

/** The `[ref]` chip's text (UI-principles §2.2) — `main`, or a tag's own name. There's no `branch:` case yet: `parseRefParam` never produces one (see its own comment). */
export function refLabelOf(ref: Ref): string {
  return ref.kind === 'main' ? 'main' : ref.name;
}

/** The commit_id a ref resolves to, or `null` if it doesn't resolve (an unknown tag name, or a model with no commits yet). */
export async function resolveRef(supabase: Client, modelId: UUID, ref: Ref): Promise<UUID | null> {
  if (ref.kind === 'main') {
    const main = await getMainBranch(supabase, modelId);
    return main?.head_commit_id ?? null;
  }
  const { data, error } = await supabase.from('tags').select('commit_id').eq('model_id', modelId).eq('name', ref.name).maybeSingle();
  if (error) throw new Error(`resolveRef: ${error.message}`);
  // `data`'s inferred shape already has commit_id assignable to UUID (so a
  // cast on the object is "unnecessary" to no-unnecessary-type-assertion),
  // but the field itself still carries `any` under the untyped client —
  // narrowed explicitly here since that's what actually leaves the
  // function's Promise<UUID | null> return type honest.
  return (data?.commit_id as UUID | undefined) ?? null;
}
