/**
 * F2 (full K1), SPEC-capture.md §7.1: the in-memory index `match.ts`'s pure
 * code searches, built once per run from one read set (`elements_head` at
 * main's head, every alias including `merged_id`, optionally the target
 * change branch's own folded head — §7.1's fifth bullet). Building the
 * index is the only I/O-adjacent part of matching; everything downstream
 * is a plain in-memory lookup, so `match.ts` stays pure and unit-testable
 * with no database or edge-function runtime at all.
 */
import type { ElementType, UUID } from '../contracts/delta';
import type { CaptureAliasType } from '../contracts/capture';
import type { ElementsHeadRow } from '../contracts/rows';
import type { Head } from '../engine/deltas';
import { normaliseName } from './normalise';

export interface MatchAliasInput {
  element_id: UUID;
  alias_value: string;
  alias_type: CaptureAliasType;
}

export interface MatchIndex {
  elements: ReadonlyMap<UUID, ElementsHeadRow>;
  elementsByType: ReadonlyMap<ElementType, readonly ElementsHeadRow[]>;
  /** Keyed by `normaliseName(alias_value)` — `merged_id` rows are excluded here (their own `alias_value` is a UUID string, not a name/source key; they feed `mergedIdAlias` instead). A normalised-value collision across two different aliases (the table's own uniqueness is per `alias_type`, not global) resolves to whichever was inserted last — the same simplification SPEC-capture.md §7.3's own pseudocode makes by looking values up with no `alias_type` in the key at all. */
  aliasByNormalisedValue: ReadonlyMap<string, { elementId: UUID; aliasType: CaptureAliasType }>;
  /** Old (merged-away) element id → surviving element id, from `alias_type = 'merged_id'` rows. */
  mergedIdAlias: ReadonlyMap<UUID, UUID>;
}

export function buildMatchIndex(elements: readonly ElementsHeadRow[], aliases: readonly MatchAliasInput[]): MatchIndex {
  const elementMap = new Map<UUID, ElementsHeadRow>();
  const byType = new Map<ElementType, ElementsHeadRow[]>();
  for (const el of elements) {
    elementMap.set(el.element_id, el);
    const bucket = byType.get(el.element_type);
    if (bucket) bucket.push(el);
    else byType.set(el.element_type, [el]);
  }

  const aliasByNormalisedValue = new Map<string, { elementId: UUID; aliasType: CaptureAliasType }>();
  const mergedIdAlias = new Map<UUID, UUID>();
  for (const alias of aliases) {
    if (alias.alias_type === 'merged_id') {
      mergedIdAlias.set(alias.alias_value, alias.element_id);
      continue;
    }
    aliasByNormalisedValue.set(normaliseName(alias.alias_value), { elementId: alias.element_id, aliasType: alias.alias_type });
  }

  return { elements: elementMap, elementsByType: byType, aliasByNormalisedValue, mergedIdAlias };
}

/**
 * K-8/§7.1's own fifth bullet, issue #285: "a candidate that matches an
 * element created on that branch resolves to it (as existing)" — a
 * lightweight second index over *only* the target change branch's own
 * elements that don't exist on main yet (an element already on main is
 * already in the ordinary `MatchIndex`; re-indexing it here would just
 * let it match twice). No aliases: §7.1 scopes learned aliases to main
 * (`aliases` is a per-model table keyed by whatever the matcher already
 * resolved against main, §7.6) — an alias only main's own reviewers have
 * ever confirmed has no equivalent yet for a still-in-review branch.
 * `runCapture.ts` tries this index only when the ordinary one misses
 * (`match.level === 'none'`), and a hit here never becomes an ordinary
 * `update`/`confirm`: the draft branch forks from main, so it has no
 * legal way to write a delta against an element main doesn't know about
 * yet — `classifyAndResolve` gives a hit here the `duplicate_in_target`
 * class instead (no delta, same shape as `invalid`/`unsourced`), so the
 * reviewer sees the collision instead of the pipeline quietly proposing
 * the same system twice.
 */
export function buildTargetOnlyMatchIndex(targetHead: Head, mainHead: Head): MatchIndex {
  const rows: ElementsHeadRow[] = [];
  for (const [elementId, el] of targetHead.elements) {
    if (mainHead.elements.has(elementId)) continue;
    rows.push({ element_id: elementId, element_type: el.elementType, name: el.name, parent_id: el.parentId, attributes: el.attributes, exists_delta_id: el.existsDeltaId });
  }
  return buildMatchIndex(rows, []);
}
