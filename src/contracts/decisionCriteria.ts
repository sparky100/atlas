/**
 * A small, fixed set of judgement criteria an architect rates each decision
 * option against — cost, effort, delivery risk, timing, vendor/strategic
 * fit. Global, code-defined, the same for every model, no admin surface —
 * same "the taxonomy has been fully known and has zero runtime enforcement
 * without it" reasoning `relationshipTypeRules.ts`'s own module comment
 * gives for why that one is a constant here rather than a table: nothing
 * about *which* criteria exist, or their level labels, is org-specific
 * content this product needs to be queryable/editable at runtime.
 *
 * Every criterion has the same three ordered, neutral keys —
 * `favourable`/`acceptable`/`unfavourable` — never a per-criterion enum,
 * so a rating's *meaning* ("this option, if chosen, would be fine here")
 * is always comparable across criteria even though the *label* a viewer
 * reads is criterion-specific ("Low" for Cost, "Before end date" for
 * Timing). Higher is never silently "better": nothing here orders
 * `favourable`/`acceptable`/`unfavourable` by a numeric scale a UI could
 * accidentally sum or sort by magnitude (out of scope, deliberately — no
 * weighting/scoring total exists to derive from these three keys, and
 * `DECISION_RATING_LEVELS`' own array order below is presentation order,
 * not a score). Each level's own `tone` is a `ChipTone` from the existing
 * good/ok/poor vocabulary (`ok`/`warn`/`danger` — the same three-step
 * progression `lifecycleTone.ts`/`criticalityTone.ts` already use for
 * their own worst-of colouring) — a rating is never colour alone; every
 * cell renders the criterion's own label text plus this tone, never the
 * tone by itself (§6.3/§8.4's "status is never colour-only" rule).
 *
 * `DecisionRatingTone` is this contract's own copy of exactly the three
 * `ChipTone` (`src/ui/components/Chip/Chip.tsx`) values this module ever
 * produces, not an import of that type — `src/contracts` stays free of any
 * `src/ui` dependency (no other file here has one), and a narrower literal
 * union is assignable everywhere a `ChipTone` is expected without a cast.
 */

/** Neutral, criterion-agnostic — what a rating *means*, independent of how any one criterion labels it. */
export type DecisionRatingLevel = 'favourable' | 'acceptable' | 'unfavourable';

/** Presentation order (favourable first) — every criteria grid, level picker, and the unit tests below iterate this, so there is exactly one place that order is decided. */
export const DECISION_RATING_LEVELS: readonly DecisionRatingLevel[] = ['favourable', 'acceptable', 'unfavourable'];

export type DecisionRatingTone = 'ok' | 'warn' | 'danger';

const RATING_LEVEL_TONE: Record<DecisionRatingLevel, DecisionRatingTone> = { favourable: 'ok', acceptable: 'warn', unfavourable: 'danger' };

export function decisionRatingLevelTone(level: DecisionRatingLevel): DecisionRatingTone {
  return RATING_LEVEL_TONE[level];
}

/**
 * One criterion's own key — also the exact string stored in
 * `decision_option_ratings.criterion` (the migration's own `check`
 * constraint lists these five verbatim) and used as this array's own
 * `key` field, so there is no separate camelCase↔snake_case translation
 * layer anywhere between the contract and the database.
 */
export type DecisionCriterionKey = 'outcome' | 'cost' | 'effort' | 'deliveryRisk' | 'timing' | 'vendorFit';

export interface DecisionCriterionDefinition {
  key: DecisionCriterionKey;
  /** The row label shown on the criteria grid. */
  label: string;
  /** This criterion's own label for each of the three neutral levels — e.g. Cost's `favourable` reads "Low", Timing's reads "Before end date". Keyed by `DecisionRatingLevel`, every criterion must supply all three (TypeScript's `Record` enforces this at the definition below, not left to a runtime fallback). */
  levelLabels: Record<DecisionRatingLevel, string>;
}

/**
 * The five criteria, in the order the brief named them — also this
 * array's own presentation order (the criteria grid's row order, PR2's
 * own `decisionCriteriaTests.test.ts` "ordering" case).
 */
export const DECISION_CRITERIA: readonly DecisionCriterionDefinition[] = [
  // First: does the option reach the outcome the business wants (item 3, PROPOSAL-outcome-on-the-need.md).
  { key: 'outcome', label: 'Reaches the outcome', levelLabels: { favourable: 'Likely', acceptable: 'Partly', unfavourable: 'Unlikely' } },
  { key: 'cost', label: 'Cost', levelLabels: { favourable: 'Low', acceptable: 'Medium', unfavourable: 'High' } },
  { key: 'effort', label: 'Effort', levelLabels: { favourable: 'Low', acceptable: 'Medium', unfavourable: 'High' } },
  { key: 'deliveryRisk', label: 'Delivery risk', levelLabels: { favourable: 'Low', acceptable: 'Medium', unfavourable: 'High' } },
  { key: 'timing', label: 'Timing', levelLabels: { favourable: 'Before end date', acceptable: 'At risk', unfavourable: 'After end date' } },
  { key: 'vendorFit', label: 'Vendor and strategic fit', levelLabels: { favourable: 'Strong', acceptable: 'Partial', unfavourable: 'Weak' } },
];

export function decisionCriterionByKey(key: string): DecisionCriterionDefinition | undefined {
  return DECISION_CRITERIA.find((c) => c.key === key);
}

/** This criterion's own label for a level — e.g. `('timing', 'unfavourable')` → `"After end date"`. `undefined` for an unrecognised criterion key, never a guessed fallback label. */
export function decisionCriterionLevelLabel(criterionKey: string, level: DecisionRatingLevel): string | undefined {
  return decisionCriterionByKey(criterionKey)?.levelLabels[level];
}

export function isDecisionRatingLevel(value: string): value is DecisionRatingLevel {
  return (DECISION_RATING_LEVELS as readonly string[]).includes(value);
}

/** The one-line note's own cap — "not a documents feature" (the brief's own words): short enough to read at a glance in a table cell, never a rich-text/long-form field. */
export const DECISION_RATING_NOTE_MAX_LENGTH = 200;

/** `null`/empty is always valid (a rating needs no note) — only a *present* note is checked against the cap. Trimmed the same way every other short free-text field in this app validates (e.g. `decisions.title`'s own `length(btrim(title)) > 0` check) — trailing whitespace alone should never tip a note over the limit or read as "has a note" when it's visually empty. */
export function isValidDecisionRatingNote(note: string | null): boolean {
  if (note === null) return true;
  return note.trim().length <= DECISION_RATING_NOTE_MAX_LENGTH;
}
