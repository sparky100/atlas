import type { UUID } from '../../contracts/delta';
import { createDecisionOption } from '../../db/decisionOptions';
import { updateDecision } from '../../db/decisions';
import type { DecisionOptionRow, DecisionRow } from '../../db/types';
import { supabase } from '../supabaseClient';

/** The title every baseline option carries. */
export const BASELINE_TITLE = 'Stay as we are';

export interface AddBaselineInput {
  orgId: UUID;
  modelId: UUID;
  decisionId: UUID;
  userId: UUID;
  /** The decision's own project (ADR-024 P1): the baseline option is created in it, like every other option. */
  projectId: UUID | null;
}

export interface AddedBaseline {
  option: DecisionOptionRow;
  decision: DecisionRow;
}

/**
 * Gives a proposed decision its "Stay as we are" baseline: a candidate with
 * no delivery branch, then recorded on the decision as its baseline. Nobody
 * has to work on the baseline, so there is nothing to fork and no empty
 * change to show in the Changes list.
 *
 * `orgId`, `modelId` and `projectId` are kept in the input because the
 * callers already have them and later branches take the same shape; the
 * candidate itself is decided only by the decision id.
 */
export async function addBaseline(input: AddBaselineInput): Promise<AddedBaseline> {
  const option = await createDecisionOption(supabase, {
    decisionId: input.decisionId,
    title: BASELINE_TITLE,
    createdBy: input.userId,
  });
  const decision = await updateDecision(supabase, input.decisionId, { baselineOptionId: option.id });
  return { option, decision };
}
