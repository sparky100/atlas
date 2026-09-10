/**
 * ADR-020 remediation, for a model seeded before `src/db/seedFromMap.ts`'s
 * fix: every capability created by `atlas.seed_from_map` used to have
 * `attributes.code` set to the template item's own code — pure seed
 * leftover, fully recoverable via `attributes.templateRef` and the
 * `template_code` alias the same seed commit already writes. This is the
 * one-off cleanup for such a model — for every capability whose current
 * `code` still equals its own template item's code (i.e., no organisation
 * has ever actually changed it), write `code: null` via one
 * `element.update` delta, all in a single commit titled "Strip seed-copied
 * Reference codes from {sector} v{version}" (mirrors
 * `syncDescriptionsFromMap.ts`'s own commit-title shape).
 *
 * A capability whose code was edited after seeding — to any value,
 * including coincidentally the same one — is left untouched: `matches`
 * below has no way to distinguish "never touched" from "re-entered the
 * same value," and treats that ambiguity as a reason to leave it alone,
 * not strip it. Once a value differs from the template's own code at all,
 * it's unambiguously a real, independently-asserted fact and was never a
 * candidate in the first place.
 *
 * Scoped to `main` only, deliberately, same reasoning as
 * `syncDescriptionsFromMap.ts`: `atlas.seed_from_map` never seeds anywhere
 * else (SPEC §5.1), so a capability with a `templateRef` only ever exists
 * on main's own history.
 *
 * Provenance: the *same* `template`-kind `sources` row the original seed
 * commit created (`src/db/sources.ts`'s `getTemplateSource`) — clearing a
 * seed-time value is that same row's own fact, corrected, not a new
 * source. Two callers, both real user sessions (ADR-015/ADR-007:
 * `atlas.commit_deltas` is `auth.uid()`-driven with no service-role grant,
 * so there is no way to write this data except as a real owner/architect
 * member): `src/ui/capabilityMap/useStripSeedCodes.ts` (an owner action,
 * if one is ever wired in) and `scripts/stripSeedCodes.ts` (the CLI
 * backfill, which signs in with real credentials first).
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

export interface StripCandidate {
  elementId: UUID;
  name: string;
  /** `facts[commit][(elementId, 'code')].delta_id`, or (no such fact ever asserted, i.e. the seed commit's own `element.create` itself) the element's own `exists_delta_id` — same fallback `useElementEditor.ts`'s `save()`/`findSyncCandidates` above use for a field with no prior value. */
  previousDeltaId: UUID;
}

/**
 * Pure matching step, independently testable. `capabilities` is every
 * capability at the commit (`listCapabilitiesForMap`); `codeFacts` is
 * every live `code` fact at that same commit, across every subject
 * (`listFactsForAttribute`) — queried once, commit-scoped, and
 * intersected here rather than once per candidate (CLAUDE.md rule 8).
 *
 * A capability is a candidate only if its current `code` is a non-empty
 * string that exactly equals its own template item's `code` — anything
 * else (no code at all, or a code that differs from the template's) means
 * either nothing to strip or a real, independently-asserted value that
 * must not be touched.
 */
export function findStripCandidates(capabilities: readonly ElementsHeadRow[], items: readonly CapabilityMapItemRow[], codeFacts: readonly FactsRow[]): StripCandidate[] {
  const itemByTemplateRef = new Map(items.map((item) => [item.id, item]));
  const codeFactBySubject = new Map(codeFacts.map((fact) => [fact.subject_id, fact]));

  const candidates: StripCandidate[] = [];
  for (const el of capabilities) {
    const attrs = el.attributes as { templateRef?: UUID; code?: string };
    if (!attrs.templateRef) continue; // never seeded from a map — nothing to strip
    if (!attrs.code) continue; // no code at all — nothing to strip

    const item = itemByTemplateRef.get(attrs.templateRef);
    if (item?.code !== attrs.code) continue; // no template match, or a real, independently-set value that differs from the template's — leave it

    candidates.push({
      elementId: el.element_id,
      name: el.name,
      previousDeltaId: codeFactBySubject.get(el.element_id)?.delta_id ?? el.exists_delta_id,
    });
  }
  return candidates;
}

/** One `element.update` delta per candidate, clearing `code` (`value: null`) — the same "clearing an optional field" shape `validateAttributeValue` normalises a UI edit to — sharing `sourceId` (the model's own `template` source) and confidence 1, "template seeds are 1.00" applying just as much to a correction of a seed-time value as to the seed itself. */
export function buildStripSeedCodesDeltas(candidates: readonly StripCandidate[], sourceId: UUID): Delta[] {
  return candidates.map(
    (candidate): Delta => ({
      kind: 'element.update',
      id: crypto.randomUUID(),
      elementId: candidate.elementId,
      elementType: 'capability',
      attribute: 'code',
      value: null,
      previousDeltaId: candidate.previousDeltaId,
      sourceId,
      confidence: 1,
    }),
  );
}

export interface StripSeedCodesFromMapInput {
  modelId: UUID;
}

// `kind` is the discriminant, not `stripped` directly, same reasoning as
// `SyncDescriptionsResult`'s own comment: `stripped: 0` vs. `stripped:
// number` don't discriminate cleanly on their own.
export type StripSeedCodesResult =
  | { ok: true; kind: 'nothing-to-strip'; message: string }
  | { ok: true; kind: 'stripped'; stripped: number; commitId: UUID }
  | { ok: false; message: string };

/**
 * Finds and clears every seed-leftover `code` for `modelId`, in one commit
 * on main. `kind: 'nothing-to-strip'` (no commit written) when there's
 * nothing to do — a model seeded after ADR-020's fix, one with no
 * starter-map seed at all, or one where every seeded code has already
 * been given a real organisation value, is expected to hit this every
 * time; it is not an error.
 */
export async function stripSeedCodesFromMap(supabase: Client, input: StripSeedCodesFromMapInput): Promise<StripSeedCodesResult> {
  const { modelId } = input;

  const main = await getMainBranch(supabase, modelId);
  if (!main) return { ok: false, message: `model ${modelId} has no main branch` };

  const templateSource = await getTemplateSource(supabase, modelId);
  if (!templateSource?.capability_map_id) {
    return { ok: true, kind: 'nothing-to-strip', message: 'this model was not seeded from a starter map — nothing to strip' };
  }

  const map = await getCapabilityMap(supabase, templateSource.capability_map_id);
  if (!map) return { ok: false, message: 'the starter map this model was seeded from no longer exists' };

  const [capabilities, items, codeFacts] = await Promise.all([
    listCapabilitiesForMap(supabase, main.head_commit_id),
    listCapabilityMapItems(supabase, map.id),
    listFactsForAttribute(supabase, main.head_commit_id, 'code'),
  ]);

  const candidates = findStripCandidates(capabilities, items, codeFacts);
  if (candidates.length === 0) {
    return { ok: true, kind: 'nothing-to-strip', message: 'no seeded capability still carries its template\'s own code — nothing to strip' };
  }

  const deltas = buildStripSeedCodesDeltas(candidates, templateSource.id);
  const title = `Strip seed-copied Reference codes from ${map.sector} v${String(map.version)}`;
  const envelope: CommitEnvelope = {
    id: crypto.randomUUID(),
    branchId: main.id,
    parentCommitId: main.head_commit_id,
    mergedBranchHeadCommitId: null,
    kind: 'manual',
    title,
    body: `Cleared ${String(candidates.length)} seed-copied code(s), never independently edited since seeding (ADR-020).`,
    deltas,
  };

  const result = await commitToBranch(supabase, { modelId, branchId: main.id, expectedHeadCommitId: main.head_commit_id, envelope });
  if (!result.ok) return { ok: false, message: result.message };
  return { ok: true, kind: 'stripped', stripped: candidates.length, commitId: result.commitId };
}
