/**
 * F2 (full K1), SPEC-capture.md §7.3: `match(candidate, index) -> MatchOutcome`
 * — order fixed, first hit wins. Pure; `matchIndex.ts` builds the one
 * in-memory index this searches from a single read set (§7.1).
 *
 * `context` resolution (§7.4) is the caller's job, not this module's: a
 * proposal's own `parent` field can point at *another candidate in this
 * same run* (`{kind:'candidate', seq}`), which needs the whole batch
 * resolved together — that orchestration lives in `rowsToCandidates.ts`/
 * `runCapture.ts` (later PRs). `matchElement` here takes the already-
 * resolved context id directly, keeping this module pure and unit-testable
 * on its own.
 *
 * Deliberate, disclosed narrowing of §7.3's own alias step: the pseudocode
 * also tries "normalised name stems" alongside source keys and the full
 * normalised name — SPEC never defines what a "stem" is here (word
 * segmentation risks false-positive matches on common single words with no
 * documented rule to bound it), so this first pass matches source keys and
 * the full name only. Every fixture in §12 that needs alias matching is
 * expressed as a source-key or full-name alias, never a partial-word one.
 */
import type { ElementType, UUID } from '../contracts/delta';
import { IDENTITY_TRIGRAM_THRESHOLD, trigramSimilarity } from '../engine/trigram';
import type { MatchOutcome } from '../contracts/capture';
import type { ElementsHeadRow } from '../contracts/rows';
import { normaliseName } from './normalise';
import type { MatchIndex } from './matchIndex';

/**
 * §7.4: system/actor carry no parent context at all; container/capability
 * must share the same parent (or both be top-level). `string`, not
 * `UUID | 'top-level'` — `UUID` is itself a plain `string` alias, so a
 * literal union with it is redundant (same reasoning `roadmapLifecycleRows.ts`'s
 * own `UNASSIGNED_GROUP_KEY` sentinel comment gives); a value no real
 * element id can equal is used instead of a type-level distinction.
 */
export type MatchContext = string;

/** The sentinel `MatchContext` value for "this type carries no parent context at all" — no real element id is ever literally this string. */
export const TOP_LEVEL_CONTEXT = 'top-level';

export interface MatchElementInput {
  name: string;
  elementType: ElementType;
  /** A id the document itself names for this row, if any (e.g. an `atlasId` column) — level 1. */
  atlasId?: UUID;
  /** Source-system keys the document carries for this row — level 2, alongside the full name. */
  sourceKeys?: string[];
  context: MatchContext;
}

const SIMILAR_THRESHOLD = 0.5;
const AMBIGUOUS_MARGIN = 0.05;
const MAX_AMBIGUOUS = 5;

function contextMatches(elementType: ElementType, context: MatchContext, candidate: ElementsHeadRow): boolean {
  if (elementType === 'system' || elementType === 'actor') return true;
  if (context === TOP_LEVEL_CONTEXT) return candidate.parent_id === null;
  return candidate.parent_id === context;
}

export function matchElement(input: MatchElementInput, index: MatchIndex): MatchOutcome {
  const warnings: MatchOutcome['warnings'] = [];

  // 1. exact id.
  if (input.atlasId !== undefined) {
    const direct = index.elements.get(input.atlasId);
    if (direct?.element_type === input.elementType) {
      return { level: 'exact_id', elementId: input.atlasId, score: 1, similar: [], warnings: [] };
    }
    const survivor = index.mergedIdAlias.get(input.atlasId);
    if (survivor !== undefined) {
      return { level: 'exact_id', elementId: survivor, score: 1, similar: [], warnings: ['RESOLVED_THROUGH_MERGED_ID'] };
    }
    warnings.push('ATLAS_ID_NOT_FOUND');
  }

  // 2. alias — source keys, then the full normalised name.
  for (const raw of [...(input.sourceKeys ?? []), input.name]) {
    const hit = index.aliasByNormalisedValue.get(normaliseName(raw));
    if (!hit) continue;
    const el = index.elements.get(hit.elementId);
    if (el?.element_type === input.elementType) {
      return { level: 'alias', elementId: hit.elementId, score: 1, aliasType: hit.aliasType, similar: [], warnings };
    }
  }

  // 3. name + type + context.
  const pool = (index.elementsByType.get(input.elementType) ?? []).filter((el) => contextMatches(input.elementType, input.context, el));
  const normalisedName = normaliseName(input.name);
  const scored = pool.map((el) => ({ el, score: trigramSimilarity(normalisedName, normaliseName(el.name)) }));
  const hits = scored
    .filter((s) => s.score >= IDENTITY_TRIGRAM_THRESHOLD)
    .sort((a, b) => b.score - a.score || a.el.name.localeCompare(b.el.name) || a.el.element_id.localeCompare(b.el.element_id));
  const similar = scored
    .filter((s) => s.score >= SIMILAR_THRESHOLD && s.score < IDENTITY_TRIGRAM_THRESHOLD)
    .map((s) => ({ elementId: s.el.element_id, name: s.el.name, score: s.score }));

  if (hits.length === 0) return { level: 'none', score: 0, similar, warnings };

  const best = hits[0];
  if (!best) return { level: 'none', score: 0, similar, warnings };
  const runnerUp = hits[1];
  const isAmbiguous = runnerUp !== undefined && best.score - runnerUp.score < AMBIGUOUS_MARGIN;

  return {
    level: 'name_context',
    elementId: best.el.element_id,
    score: best.score,
    similar,
    warnings,
    ...(isAmbiguous ? { ambiguous: hits.slice(0, MAX_AMBIGUOUS).map((h) => ({ elementId: h.el.element_id, name: h.el.name, score: h.score })) } : {}),
  };
}
