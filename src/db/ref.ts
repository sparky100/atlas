/**
 * Ref resolution (UI-principles.md §2.4's grammar: `main | tag:{name} |
 * branch:{slug} | commit:{id}`). Sprint C1 adds `branch:` — routed on the
 * branch's real id rather than a slug, since `branches` has no separate
 * slug column of its own (src/ui/changes/ChangeView.tsx's own comment made
 * the same call for the change page's URL). Sprint U4-1 B2 adds `commit:`
 * — an arbitrary commit id, not a tag or a branch head — for the activity
 * row's "link to the commit diff" (ArchitectHome.tsx): `?ref=commit:{id}`
 * paired with `?diff=commit:{parentId}` on VersionDiffPage.tsx, which
 * already worked for any commit id (`useVersionDiff.ts`'s `foldFromGenesis`
 * takes one directly, no materialised-projection dependency) and was only
 * ever missing this ref-string plumbing to reach it. `VersionDiffView.tsx`
 * then links each changed element at that same ref, so `useElementPage.ts`
 * does receive a `commit:` ref too — and gets the identical "not
 * materialised, fold in memory instead" fix that page already has for a
 * branch head, see its own module comment. No *other* `if (ref.kind ===
 * 'branch')`-shaped check elsewhere in `src/ui` has a `commit:` case yet;
 * those are unreached by it (nothing else builds one), not silently wrong
 * for it.
 */
import { assertRealId } from './assertRealId';
import { getBranch, getMainBranch } from './branches';
import type { Client } from './client';
import type { UUID } from '../contracts/delta';
import type { BranchRow } from './types';

export type Ref = { kind: 'main' } | { kind: 'tag'; name: string } | { kind: 'branch'; branchId: UUID } | { kind: 'commit'; commitId: UUID };

export function parseRefParam(raw: string | undefined | null): Ref {
  if (!raw || raw === 'main') return { kind: 'main' };
  if (raw.startsWith('tag:')) return { kind: 'tag', name: raw.slice(4) };
  if (raw.startsWith('branch:')) return { kind: 'branch', branchId: raw.slice(7) };
  // Sprint U4-1 B2 is this grammar's first real reader: the activity row's
  // own "link to the commit diff" (ArchitectHome.tsx), diffing an arbitrary
  // main commit against its parent — VersionDiffPage.tsx/useVersionDiff.ts
  // already worked for any commit id (foldFromGenesis takes one directly),
  // this was only ever missing the ref-string plumbing to reach them.
  if (raw.startsWith('commit:')) return { kind: 'commit', commitId: raw.slice(7) };
  return { kind: 'main' };
}

export function refParamOf(ref: Ref): string {
  if (ref.kind === 'main') return 'main';
  if (ref.kind === 'tag') return `tag:${ref.name}`;
  if (ref.kind === 'commit') return `commit:${ref.commitId}`;
  return `branch:${ref.branchId}`;
}

/**
 * S1 item 2 ("View this change"): the query string for a link that must
 * carry both the ref *and* whether it's a read-only viewing ref, not the
 * editing one — `?ref=branch:x&viewing=1` vs plain `?ref=branch:x`. One
 * helper rather than every call site hand-appending `viewing` next to its
 * own `refParamOf(ref)` (`ModelNav.tsx`, `LandscapePage.tsx`,
 * `ElementPage.tsx`'s own href builders, `zoomQueryString`) — the same
 * "one place, not one per caller" reasoning `refParamOf` itself already
 * gives the ref string. Never emits `viewing=1` for `main` — nothing to
 * view read-only there (`SelectedRefProvider`'s own write-effect only
 * ever *checks* for `viewing` on a `branch:` ref for the identical
 * reason).
 */
export function refQueryParam(ref: Ref, viewing: boolean): string {
  const base = `ref=${refParamOf(ref)}`;
  return viewing && ref.kind === 'branch' ? `${base}&viewing=1` : base;
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
  if (ref.kind === 'commit') return `commit ${ref.commitId.slice(0, 8)}`;
  return `Change: ${branchLabel ?? ref.branchId.slice(0, 8)}`;
}

/** The commit_id a ref resolves to, or `null` if it doesn't resolve (an unknown tag name, an unknown/deleted branch, an unknown commit id, or a model with no commits yet). A branch ref resolves to its **to-be** head — §6.2's default lens — not its as-is base; `resolveBranchRef` is what a caller building the As-is/To-be/Diff selector itself needs instead. */
export async function resolveRef(supabase: Client, modelId: UUID, ref: Ref): Promise<UUID | null> {
  // This is the chokepoint every model-scoped hook's ref resolution funnels
  // through — the guard belongs here once rather than re-added at each of
  // the four branches below (SPEC's own "empty/undefined id filters throw
  // before the request", item 2). See assertRealId.ts's own module comment
  // for the exact live 400 (`useBreadcrumbElement` calling this with `''`)
  // this closes off.
  assertRealId('resolveRef', 'model_id', modelId);
  if (ref.kind === 'main') {
    const main = await getMainBranch(supabase, modelId);
    return main?.head_commit_id ?? null;
  }
  if (ref.kind === 'branch') {
    const branch = await getBranch(supabase, ref.branchId);
    return branch?.head_commit_id ?? null;
  }
  if (ref.kind === 'commit') {
    // Confirms the id is a real commit of *this* model rather than trusting
    // a caller-supplied id outright — the same defensiveness `tag`/`branch`
    // get below/above, not a hard requirement `foldFromGenesis` itself has.
    const { data, error } = await supabase.from('commits').select('id').eq('model_id', modelId).eq('id', ref.commitId).maybeSingle();
    if (error) throw new Error(`resolveRef: ${error.message}`);
    return (data?.id as UUID | undefined) ?? null;
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
