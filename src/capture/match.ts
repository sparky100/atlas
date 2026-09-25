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

/**
 * A document commonly doesn't say which of these two an extracted name
 * actually is — Prompt B's own system/container distinction rests on the
 * document explicitly naming a parent nearby ("container: … parentName
 * (the system it is part of)"); a platform's own module mentioned without
 * that phrasing reads exactly like a top-level application, so the model
 * reasonably calls it `system`. Found via real capture review: a module
 * ("ESCOMS") extracted as a `system`, with no parent, found no match at
 * all in a pool strictly scoped to `system`-typed elements, even though it
 * already existed as a `container`. `system`/`container` are the only pair
 * this applies to — `capability`/`actor` are never mistaken for either
 * (nothing in Prompt B's own taxonomy could produce that confusion).
 */
function crossTypeFallback(elementType: ElementType): ElementType | null {
  if (elementType === 'system') return 'container';
  if (elementType === 'container') return 'system';
  return null;
}

export type TrigramMatchResult = Pick<MatchOutcome, 'level' | 'elementId' | 'score' | 'similar' | 'ambiguous'>;

/**
 * The trigram-scoring half of level 3, factored out so a caller that isn't
 * matching one already-typed, already-contexted candidate against the model
 * (`matchElement` below) can still share the same threshold/ambiguity rules
 * against a pool it built itself — `capabilityAssignment.ts`'s own §6.3
 * capability search is exactly that: it searches every capability
 * regardless of level/parent, never one context-filtered bucket, so it
 * can't go through `matchElement`'s own `context` param at all.
 */
export function resolveByTrigram(name: string, pool: readonly ElementsHeadRow[]): TrigramMatchResult {
  const normalisedName = normaliseName(name);
  const scored = pool.map((el) => ({ el, score: trigramSimilarity(normalisedName, normaliseName(el.name)) }));
  const hits = scored
    .filter((s) => s.score >= IDENTITY_TRIGRAM_THRESHOLD)
    .sort((a, b) => b.score - a.score || a.el.name.localeCompare(b.el.name) || a.el.element_id.localeCompare(b.el.element_id));
  const similar = scored
    .filter((s) => s.score >= SIMILAR_THRESHOLD && s.score < IDENTITY_TRIGRAM_THRESHOLD)
    .map((s) => ({ elementId: s.el.element_id, name: s.el.name, score: s.score }));

  if (hits.length === 0) return { level: 'none', score: 0, similar };

  const best = hits[0];
  if (!best) return { level: 'none', score: 0, similar };
  const runnerUp = hits[1];
  const isAmbiguous = runnerUp !== undefined && best.score - runnerUp.score < AMBIGUOUS_MARGIN;

  return {
    level: 'name_context',
    elementId: best.el.element_id,
    score: best.score,
    similar,
    ...(isAmbiguous ? { ambiguous: hits.slice(0, MAX_AMBIGUOUS).map((h) => ({ elementId: h.el.element_id, name: h.el.name, score: h.score })) } : {}),
  };
}

/**
 * A document's own platform-qualified naming convention ("SAP PM" in the
 * prose, for a container whose own stored `name` is just "PM" under
 * platform "SAP") is a document-authoring habit, not stored data — a
 * container's own `name` never repeats its parent platform's name (that
 * combination, "Platform · Module", is `moduleDisplayName`'s own UI
 * formatting concern elsewhere, not anything persisted). Found via real
 * capture review: "SAP PM" extracted as a top-level `system` with no
 * parent (the document never says "PM is a module of SAP" in so many
 * words — it just writes the platform name inline), found no match at
 * levels 1–4 even though "PM" already exists as a container of "SAP".
 *
 * Tried only after every earlier level has failed. `normaliseName`
 * already collapses every separator variant (space, `·`, `-`, `:`, …) to
 * a single space and lowercases, so matching against `<normalised
 * platform name> ` as a literal prefix covers all of them without extra
 * separator-specific logic. The remainder must still clear the normal
 * identity threshold against one of *that specific platform's* own
 * containers — a wrong strip just fails to match (falls through to
 * `none`) rather than mis-matching, since nothing here lowers the bar
 * `resolveByTrigram` already enforces.
 */
function resolvePlatformPrefixed(name: string, index: MatchIndex): (TrigramMatchResult & { resolvedParentId?: UUID }) | null {
  const normalisedName = normaliseName(name);
  const platforms = index.elementsByType.get('system') ?? [];
  for (const platform of platforms) {
    const prefix = `${normaliseName(platform.name)} `;
    if (!normalisedName.startsWith(prefix) || normalisedName.length <= prefix.length) continue;
    const remainder = normalisedName.slice(prefix.length);
    const childPool = (index.elementsByType.get('container') ?? []).filter((el) => el.parent_id === platform.element_id);
    const hit = resolveByTrigram(remainder, childPool);
    if (hit.level !== 'none') return { ...hit, resolvedParentId: platform.element_id };
  }
  return null;
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
  const primary = resolveByTrigram(input.name, pool);
  if (primary.level !== 'none') return { ...primary, warnings };

  // 4. system/container cross-type fallback — see `crossTypeFallback`'s own
  // doc comment. Context-blind: the candidate's own declared type never
  // had a real chance to resolve a parent (a `system` proposal's own
  // `context` is always `TOP_LEVEL_CONTEXT`, `contextMatches`' own first
  // line), so a container's usual "must share the resolved parent" rule
  // would reject every real container outright — name similarity alone
  // decides this fallback, same threshold as the primary pool.
  const fallbackType = crossTypeFallback(input.elementType);
  if (fallbackType) {
    const fallbackPool = index.elementsByType.get(fallbackType) ?? [];
    const fallback = resolveByTrigram(input.name, fallbackPool);
    if (fallback.level !== 'none') return { ...fallback, warnings: [...warnings, 'MATCHED_CROSS_TYPE'] };
  }

  // 5. platform-name-prefix fallback — see `resolvePlatformPrefixed`'s own
  // doc comment. Only worth trying for `system`/`container` candidates,
  // the same pair `crossTypeFallback` covers — a document's own inline
  // "Platform Module" habit is a name-composition mistake about the same
  // two types, never `capability`/`actor`.
  if (input.elementType === 'system' || input.elementType === 'container') {
    const prefixed = resolvePlatformPrefixed(input.name, index);
    if (prefixed) {
      const { resolvedParentId, ...outcome } = prefixed;
      return { ...outcome, warnings: [...warnings, 'MATCHED_PLATFORM_PREFIX'], ...(resolvedParentId !== undefined ? { resolvedParentId } : {}) };
    }
  }

  return { ...primary, warnings };
}
