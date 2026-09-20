/**
 * F2 (full K1), SPEC-capture.md §5.5 (and §7.5's own `matchConf`, kept here
 * rather than in `match.ts` so every confidence formula — and everything
 * that composes them, `updateConf` included — lives in one module): the
 * confidence formulas. Every machine-extracted value capped below human
 * assertion (1.0, reserved by ADR-007/UI §4.3 for a reviewer's own edit,
 * never written here).
 */
import type { MatchOutcome } from '../contracts/capture';
export const SHEET_CONFIDENCE_CAP = 0.95;
export const PROSE_CONFIDENCE_CAP = 0.9;
export const DEFAULTED_ATTRIBUTE_CONFIDENCE = 0.6;
export const GONE_CONFIDENCE = 0.5;

/**
 * `mappingConf`'s LLM-only half — a synonym-table hit is the fixed
 * constant `1.0` and never calls this function at all; only prompt A's own
 * reported confidence is clipped to [0, 0.90], so an LLM mapping guess can
 * never itself claim the near-certainty a real synonym-table hit gets.
 */
export function clampMappingConfidence(rawConfidence: number): number {
  return Math.max(0, Math.min(0.9, rawConfidence));
}

/** The warning codes `parseFactor` actually discounts — every other `EvidenceWarning` code (e.g. `MERGED_CELL`, which feeds `rowFactor` instead) leaves the parse factor at 1.0. */
const PARSE_FACTORS: Readonly<Record<string, number>> = {
  ENUM_FUZZY: 0.95,
  AMBIGUOUS_DATE: 0.8,
  MULTI_VALUE_CELL: 0.9,
  ROWS_DISAGREE: 0.9,
};

/** `parseFactor(cell)`: the lowest factor among this cell's own warning codes, or 1.0 (exact) when none apply. */
export function parseFactorFor(warningCodes: readonly string[]): number {
  let factor = 1;
  for (const code of warningCodes) {
    const known = PARSE_FACTORS[code];
    if (known !== undefined) factor = Math.min(factor, known);
  }
  return factor;
}

/** `rowFactor`: 0.95 if the row touches a merged range or has a formula error, else 1.0. */
export function rowFactorFor(touchesMergedRangeOrFormulaError: boolean): number {
  return touchesMergedRangeOrFormulaError ? 0.95 : 1;
}

export interface SheetAttrConfInput {
  mappingConfidence: number;
  parseFactor: number;
  rowFactor: number;
}

/** `sheetAttrConf(col, cell) = min(0.95, mappingConf × parseFactor × rowFactor)`. */
export function sheetAttrConf(input: SheetAttrConfInput): number {
  return Math.min(SHEET_CONFIDENCE_CAP, input.mappingConfidence * input.parseFactor * input.rowFactor);
}

/** `groundingFactor`: 1.0 exact; 0.85 when the passage was found only after whitespace/quote normalisation (`PASSAGE_NORMALISED`). */
export function groundingFactorFor(passageNormalised: boolean): number {
  return passageNormalised ? 0.85 : 1;
}

export interface ProseAttrConfInput {
  modelConfidence: number;
  groundingFactor: number;
}

/** `proseAttrConf(fact) = min(0.90, modelConf × groundingFactor)`. */
export function proseAttrConf(input: ProseAttrConfInput): number {
  return Math.min(PROSE_CONFIDENCE_CAP, input.modelConfidence * input.groundingFactor);
}

/** `existenceConf(candidate) = min over {name, required attributes present} of attrConf` — also `candidateConf`, written on create deltas and `capture_candidates.confidence` (§5.5). An empty list floors at 0 rather than `Math.min()`'s own empty-call `Infinity` — every real candidate asserts at least its own name, so this only guards against a caller bug, never a real candidate. */
export function existenceConf(attributeConfidences: readonly number[]): number {
  return attributeConfidences.length === 0 ? 0 : Math.min(...attributeConfidences);
}

/** `updateConf(attr) = min(attrConf(attr), matchConf)` — §7.5's own match confidence caps how strongly an *update* to an already-matched element can be asserted. */
export function updateConf(attrConfidence: number, matchConfidence: number): number {
  return Math.min(attrConfidence, matchConfidence);
}

/**
 * §7.5's own `matchConf`: `exact_id`/`alias` are 0.95 flat (a real id or
 * alias hit, never fuzzy); `name_context` rescales its own trigram `score`
 * (0.60 identity threshold–1.00) onto 0.60–0.95 linearly. `'none'` only
 * ever describes a `new` candidate, which never reaches `updateConf` at
 * all (there is no main fact to update against) — 0 is a safe, unused
 * floor for that case, not a value any real caller depends on.
 */
export function matchConfidenceFor(match: Pick<MatchOutcome, 'level' | 'score'>): number {
  if (match.level === 'exact_id' || match.level === 'alias') return 0.95;
  if (match.level === 'name_context') return 0.6 + (0.35 * (match.score - 0.6)) / 0.4;
  return 0;
}
