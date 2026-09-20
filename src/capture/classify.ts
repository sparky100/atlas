/**
 * F2 (full K1), SPEC-capture.md §4.4: assigns the class a matched (or
 * unmatched) candidate gets, from its proposal, its match outcome and
 * main's own current facts.
 *
 * Scope, disclosed: this module assigns the five classes matching actually
 * decides between — `new`, `update`, `confirm`, `conflict`, `ambiguous`.
 * `invalid`/`unsourced` are structural/grounding failures assigned upstream
 * of matching entirely (illegal deltas, ungrounded passages — `rowsToCandidates.ts`/
 * `ground.ts`, later PRs) and never reach this module; `gone` is re-import-only
 * (`reimportDiff.ts`, PR9) and has nothing to do with matching a document
 * row against main at all. Relationships never get `ambiguous` (§7.3's
 * ambiguity band is a name-matching concept; a relationship candidate's own
 * `from`/`to` are resolved element-by-element, then checked for an exact
 * `(type, from, to)` triple) or `gone` in this pass (system retirement's
 * own `gone` shape is element-specific — SPEC §4.4).
 */
import type { CandidateClass, MatchOutcome } from '../contracts/capture';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Values here are always JSON-shaped (an attribute's own stored value) — primitives, arrays, or plain objects, never a `Date`/`Map`/class instance. */
export function deepEqualJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqualJson(v, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((key) => Object.hasOwn(b, key) && deepEqualJson(a[key], b[key]));
  }
  return false;
}

export interface AttributeMainFact {
  value: unknown;
  confidence: number;
  /** `effective_date` if set, else the fact's own assertion date (§4.4: "its `effective_date` (else its commit date)"). */
  effectiveOrAssertedDate: string;
}

export interface AttributeComparisonInput {
  proposedValue: unknown;
  proposedConfidence: number;
  mainFact: AttributeMainFact | undefined;
  /** The capturing source's own `captured_at` (§4.4 compares this against main's own effective/asserted date) — `null` when the document has none recorded. */
  sourceCapturedAt: string | null;
}

export type AttributeOutcome = 'update' | 'confirm' | 'conflict';

/** One attribute's own outcome — §4.4's rule, applied per attribute; the candidate's overall class aggregates every proposed attribute's outcome (see `classifyElement`). */
export function classifyAttribute(input: AttributeComparisonInput): AttributeOutcome {
  if (input.mainFact === undefined) return 'update';
  if (deepEqualJson(input.proposedValue, input.mainFact.value)) return 'confirm';
  const mainConfidenceStronger = input.mainFact.confidence >= input.proposedConfidence;
  const mainDateStronger = input.sourceCapturedAt !== null && input.mainFact.effectiveOrAssertedDate > input.sourceCapturedAt;
  return mainConfidenceStronger || mainDateStronger ? 'conflict' : 'update';
}

export interface ClassifyElementInput {
  match: MatchOutcome;
  /** One entry per attribute the proposal actually asserts — `classifyAttribute`'s own per-attribute inputs, already resolved by the caller (main's current fact for that attribute, if any). */
  attributes: readonly AttributeComparisonInput[];
}

/** §4.4's element table, minus `invalid`/`unsourced`/`gone` (see this module's own header comment). */
export function classifyElement(input: ClassifyElementInput): Extract<CandidateClass, 'new' | 'update' | 'confirm' | 'conflict' | 'ambiguous'> {
  if (input.match.ambiguous && input.match.ambiguous.length > 0) return 'ambiguous';
  if (input.match.level === 'none') return 'new';

  const outcomes = input.attributes.map((attr) => classifyAttribute(attr));
  if (outcomes.some((o) => o === 'conflict')) return 'conflict';
  if (outcomes.every((o) => o === 'confirm')) return 'confirm';
  return 'update';
}

export interface ClassifyRelationshipInput {
  /** Whether a live `(type, from, to)` relationship already exists on main — relationship matching is exact-triple, never fuzzy (§7's own scope is element matching; a relationship's identity is its endpoints). */
  existingRelationship: { attributes: readonly AttributeComparisonInput[] } | undefined;
}

/** §4.4's relationship rows — `new` (no existing triple) or `update`/`confirm`/`conflict` (one already exists, compared attribute by attribute exactly as `classifyElement` does). */
export function classifyRelationship(input: ClassifyRelationshipInput): Extract<CandidateClass, 'new' | 'update' | 'confirm' | 'conflict'> {
  if (!input.existingRelationship) return 'new';
  const outcomes = input.existingRelationship.attributes.map((attr) => classifyAttribute(attr));
  if (outcomes.some((o) => o === 'conflict')) return 'conflict';
  if (outcomes.length === 0 || outcomes.every((o) => o === 'confirm')) return 'confirm';
  return 'update';
}
