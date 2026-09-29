/**
 * `decision_option_ratings` repository operations
 * (`20260929010000_decision_option_ratings.sql`) — one row per
 * (decision, option, criterion), the criteria/levels themselves defined in
 * `src/contracts/decisionCriteria.ts`. Thin, typed wrappers, same division
 * of labour `decisions.ts`'s own module comment draws — no business logic
 * beyond what a single upsert/select needs.
 *
 * `upsertDecisionRating` is the one write path — "tap to set or change a
 * rating" is the same request either way (no existing row vs. an existing
 * one to overwrite), so this is a plain `.upsert` keyed on the table's own
 * primary key, not two separate insert/update call sites for the caller
 * to choose between. RLS (not this function) is what actually makes an
 * already-chosen decision's ratings read-only — a write attempt here on
 * such a decision fails with a Postgres RLS error, surfaced the same way
 * every other RLS rejection in this codebase already is (a thrown `Error`
 * with the driver's own message).
 */
import { assertRealId } from './assertRealId';
import type { Client } from './client';
import type { DecisionOptionRatingRow, DecisionRatingCriterion, DecisionRatingLevelValue } from './types';
import type { UUID } from '../contracts/delta';

export async function listDecisionRatingsForDecision(supabase: Client, decisionId: UUID): Promise<DecisionOptionRatingRow[]> {
  assertRealId('listDecisionRatingsForDecision', 'decision_id', decisionId);
  const { data, error } = await supabase.from('decision_option_ratings').select('*').eq('decision_id', decisionId);
  if (error) throw new Error(`listDecisionRatingsForDecision: ${error.message}`);
  return data as DecisionOptionRatingRow[];
}

export interface UpsertDecisionRatingInput {
  decisionId: UUID;
  branchId: UUID;
  criterion: DecisionRatingCriterion;
  level: DecisionRatingLevelValue;
  /** `null` clears the note (still a valid rating, per `isValidDecisionRatingNote`'s own "null/empty is always valid") — trimmed and length-checked by the caller (`useDecisionRatings.ts`) before this is ever called; the database's own `check` constraint is the last-resort backstop, not the primary validation point. */
  note: string | null;
  ratedBy: UUID;
}

export async function upsertDecisionRating(supabase: Client, input: UpsertDecisionRatingInput): Promise<DecisionOptionRatingRow> {
  const row = { decision_id: input.decisionId, branch_id: input.branchId, criterion: input.criterion, level: input.level, note: input.note, rated_by: input.ratedBy, rated_at: new Date().toISOString() };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.from('decision_option_ratings').upsert(row, { onConflict: 'decision_id,branch_id,criterion' }).select('*').single();
  if (error) throw new Error(`upsertDecisionRating: ${error.message}`);
  return data as DecisionOptionRatingRow;
}
