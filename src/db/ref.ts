/**
 * Ref resolution (UI-principles.md §2.4's grammar: `main | tag:{name} |
 * branch:{slug} | commit:{id}`). Sprint C1 adds `branch:` — routed on the
 * branch's real id rather than a slug, since `branches` has no separate
 * slug column of its own (src/ui/changes/ChangeView.tsx's own comment made
 * the same call for the change page's URL). `commit:` is still real, named
 * grammar this will grow into later, not silently dropped.
 */
import { getBranch, getMainBranch } from './branches';
import type { Client } from './client';
import type { UUID } from '../contracts/delta';
import type { BranchRow } from './types';

export type Ref = { kind: 'main' } | { kind: 'tag'; name: string } | { kind: 'branch'; branchId: UUID };

export function parseRefParam(raw: string | undefined | null): Ref {
  if (!raw || raw === 'main') return { kind: 'main' };
  if (raw.startsWith('tag:')) return { kind: 'tag', name: raw.slice(4) };
  if (raw.startsWith('branch:')) return { kind: 'branch', branchId: raw.slice(7) };
  // commit: isn't reachable yet (no page renders an arbitrary historical
  // commit read-only); default to main rather than erroring on a ref this
  // page can't use yet.
  return { kind: 'main' };
}

export function refParamOf(ref: Ref): string {
  if (ref.kind === 'main') return 'main';
  if (ref.kind === 'tag') return `tag:${ref.name}`;
  return `branch:${ref.branchId}`;
}

/**
 * The `[ref]` chip's text (UI-principles §2.2) — `main`, a tag's own name,
 * or `Change: {title}` for a branch (§2.2's own example). `branchLabel`,
 * when given, is normally a branch's `title ?? name` — callers rendering a
 * branch ref already have the `BranchRow` in hand (they need
 * `base_commit_id`/`head_commit_id` for the As-is/To-be/Diff selector
 * anyway, via `resolveBranchRef` below) and pass its label through; absent,
 * this falls back to a short id fragment rather than nothing.
 */
export function refLabelOf(ref: Ref, branchLabel?: string): string {
  if (ref.kind === 'main') return 'main';
  if (ref.kind === 'tag') return ref.name;
  return `Change: ${branchLabel ?? ref.branchId.slice(0, 8)}`;
}

/** The commit_id a ref resolves to, or `null` if it doesn't resolve (an unknown tag name, an unknown/deleted branch, or a model with no commits yet). A branch ref resolves to its **to-be** head — §6.2's default lens — not its as-is base; `resolveBranchRef` is what a caller building the As-is/To-be/Diff selector itself needs instead. */
export async function resolveRef(supabase: Client, modelId: UUID, ref: Ref): Promise<UUID | null> {
  if (ref.kind === 'main') {
    const main = await getMainBranch(supabase, modelId);
    return main?.head_commit_id ?? null;
  }
  if (ref.kind === 'branch') {
    const branch = await getBranch(supabase, ref.branchId);
    return branch?.head_commit_id ?? null;
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

/** The branch row behind a `branch:` ref — `null` for every other ref kind, or an unknown/deleted branch id. What the As-is/To-be/Diff selector (UI-principles §6.2) needs beyond `resolveRef`'s single commit: `base_commit_id` (As-is) and `head_commit_id` (To-be) together. */
export async function resolveBranchRef(supabase: Client, ref: Ref): Promise<BranchRow | null> {
  if (ref.kind !== 'branch') return null;
  return getBranch(supabase, ref.branchId);
}
