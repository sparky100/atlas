/**
 * Bug A2 remediation, for a model that was already seeded before
 * src/db/seedFromMap.ts's fix: every capability with `attributes.templateRef`
 * set but an empty `attributes.description` had the starter map's own
 * description silently dropped at seed time. This is the one-off sync for
 * such a model — for every capability like that, write the map item's own
 * description via one `element.update` delta, all in a single commit titled
 * "Sync descriptions from {sector} v{version}" (mirrors seedFromMap.ts's own
 * "Seed from {sector} v{version}").
 *
 * Scoped to `main` only, deliberately: `atlas.seed_from_map` never seeds
 * anywhere else (SPEC §5.1), so a capability with a `templateRef` only ever
 * exists on main's own history.
 *
 * Provenance: the *same* `template`-kind `sources` row the original seed
 * commit created (src/db/sources.ts's `getTemplateSource`) — this is that
 * row's own fact, restated correctly, not a new source. `sources_insert`'s
 * RLS wouldn't let an authenticated user create a fresh `template` source
 * anyway (supabase/migrations/20260906071500_sources_and_aliases.sql) — only
 * `atlas.seed_from_map` itself, a service-role path, can do that.
 *
 * Two callers, both real user sessions (per ADR-015/ADR-007: `atlas.
 * commit_deltas` is `auth.uid()`-driven and has no service-role grant, so
 * there is no way to write this data except as a real owner/architect
 * member): src/ui/capabilityMap/useSyncDescriptions.ts (the owner action)
 * and scripts/syncDescriptionsFromMap.ts (the CLI backfill, which signs in
 * with real credentials first).
 */
import type { CapabilityMapItemRow } from './capabilityMapTemplates';
import type { CommitEnvelope, Delta, UUID } from '../contracts/delta';
import type { ElementsHeadRow, FactsRow } from '../contracts/rows';
import { listCapabilitiesForMap } from './capabilityMap';
import { getCapabilityMap, listCapabilityMapItems } from './capabilityMapTemplates';
import type { Client } from './client';
import { commitToBranch } from './commits';
import { listFactsForAttribute } from './elements';
import { getMainBranch } from './branches';
import { getTemplateSource } from './sources';

export interface SyncCandidate {
  elementId: UUID;
  name: string;
  description: string;
  /** `facts[commit][(elementId, 'description')].delta_id`, or (no such fact ever asserted) the element's own `exists_delta_id` — same fallback src/ui/elements/useElementEditor.ts's `save()` uses for a field with no prior value. */
  previousDeltaId: UUID;
}

/**
 * Pure matching step, independently testable. `capabilities` is every
 * capability at the commit (src/db/capabilityMap.ts's `listCapabilitiesForMap`);
 * `descriptionFacts` is every live `description` fact at that same commit,
 * across every subject (`listFactsForAttribute`) — queried once,
 * commit-scoped, and intersected here rather than once per candidate
 * (CLAUDE.md rule 8).
 */
export function findSyncCandidates(
  capabilities: readonly ElementsHeadRow[],
  items: readonly CapabilityMapItemRow[],
  descriptionFacts: readonly FactsRow[],
): SyncCandidate[] {
  const itemByTemplateRef = new Map(items.map((item) => [item.id, item]));
  const descriptionFactBySubject = new Map(descriptionFacts.map((fact) => [fact.subject_id, fact]));

  const candidates: SyncCandidate[] = [];
  for (const el of capabilities) {
    const attrs = el.attributes as { templateRef?: UUID; description?: string };
    if (!attrs.templateRef) continue; // never seeded from a map — nothing to sync
    if (attrs.description && attrs.description.trim() !== '') continue; // already has a real description

    const item = itemByTemplateRef.get(attrs.templateRef);
    const description = item?.description?.trim();
    if (!description) continue; // the map item itself has no description either — nothing to write

    candidates.push({
      elementId: el.element_id,
      name: el.name,
      description,
      previousDeltaId: descriptionFactBySubject.get(el.element_id)?.delta_id ?? el.exists_delta_id,
    });
  }
  return candidates;
}

/** One `element.update` delta per candidate, sharing `sourceId` (the model's own `template` source) and confidence 1 — "template seeds are 1.00" applies just as much to a fact restated from the same template later. */
export function buildSyncDescriptionsDeltas(candidates: readonly SyncCandidate[], sourceId: UUID): Delta[] {
  return candidates.map(
    (candidate): Delta => ({
      kind: 'element.update',
      id: crypto.randomUUID(),
      elementId: candidate.elementId,
      elementType: 'capability',
      attribute: 'description',
      value: candidate.description,
      previousDeltaId: candidate.previousDeltaId,
      sourceId,
      confidence: 1,
    }),
  );
}

export interface SyncDescriptionsFromMapInput {
  modelId: UUID;
}

// `kind` is the discriminant, not `synced`/`commitId` directly: `synced: 0`
// vs. `synced: number` don't discriminate cleanly (`number`'s type already
// includes the literal `0`), so a plain `if (result.synced === 0)` wouldn't
// narrow away `commitId`.
export type SyncDescriptionsResult =
  | { ok: true; kind: 'nothing-to-sync'; message: string }
  | { ok: true; kind: 'synced'; synced: number; commitId: UUID }
  | { ok: false; message: string };

/**
 * Finds and writes every missing description for `modelId`, in one commit
 * on main. `kind: 'nothing-to-sync'` (no commit written) when there's
 * nothing to do — a model seeded after the Bug A2 fix, or one with no
 * starter-map seed at all, is expected to hit this every time; it is not
 * an error.
 *
 * No `authorId`/`userId` parameter: nothing here needs one.
 * `commitToBranch`/`atlas.commit_deltas` derive the real author from
 * `auth.uid()` regardless of anything a caller passes (same as every other
 * commit-writing hook in this codebase) — a caller checking "is someone
 * signed in" before calling this is a UI-layer concern (see
 * src/ui/capabilityMap/useSyncDescriptions.ts), not this function's.
 */
export async function syncDescriptionsFromMap(supabase: Client, input: SyncDescriptionsFromMapInput): Promise<SyncDescriptionsResult> {
  const { modelId } = input;

  const main = await getMainBranch(supabase, modelId);
  if (!main) return { ok: false, message: `model ${modelId} has no main branch` };

  const templateSource = await getTemplateSource(supabase, modelId);
  if (!templateSource?.capability_map_id) {
    return { ok: true, kind: 'nothing-to-sync', message: 'this model was not seeded from a starter map — nothing to sync' };
  }

  const map = await getCapabilityMap(supabase, templateSource.capability_map_id);
  if (!map) return { ok: false, message: 'the starter map this model was seeded from no longer exists' };

  const [capabilities, items, descriptionFacts] = await Promise.all([
    listCapabilitiesForMap(supabase, main.head_commit_id),
    listCapabilityMapItems(supabase, map.id),
    listFactsForAttribute(supabase, main.head_commit_id, 'description'),
  ]);

  const candidates = findSyncCandidates(capabilities, items, descriptionFacts);
  if (candidates.length === 0) {
    return { ok: true, kind: 'nothing-to-sync', message: 'every seeded capability already has a description — nothing to sync' };
  }

  const deltas = buildSyncDescriptionsDeltas(candidates, templateSource.id);
  const title = `Sync descriptions from ${map.sector} v${String(map.version)}`;
  const envelope: CommitEnvelope = {
    id: crypto.randomUUID(),
    branchId: main.id,
    parentCommitId: main.head_commit_id,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title,
    body: `Filled in ${String(candidates.length)} missing description(s) from the starter map (Bug A2).`,
    deltas,
  };

  const result = await commitToBranch(supabase, { modelId, branchId: main.id, expectedHeadCommitId: main.head_commit_id, envelope });
  if (!result.ok) return { ok: false, message: result.message };
  return { ok: true, kind: 'synced', synced: candidates.length, commitId: result.commitId };
}
