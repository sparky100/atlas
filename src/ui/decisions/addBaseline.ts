import type { UUID } from '../../contracts/delta';
import { createChangeBranch, getMainBranch } from '../../db/branches';
import { createDecisionLink, updateDecision } from '../../db/decisions';
import type { BranchRow, DecisionLinkRow, DecisionRow } from '../../db/types';
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
  link: DecisionLinkRow;
  branch: BranchRow;
  decision: DecisionRow;
}

/**
 * Gives a proposed decision its "Stay as we are" baseline: an empty
 * explore-intent change branch, linked as an option like any other, then
 * recorded on the decision as its baseline. Three plain writes composed here
 * (the same shape as `useDecisionOptions`'s `addOption`); if the last one fails
 * the baseline is still a normal option, and running this again is harmless to
 * everything but a duplicate option, so callers only offer it when
 * `decision.baseline_branch_id` is null.
 */
export async function addBaseline(input: AddBaselineInput): Promise<AddedBaseline> {
  const main = await getMainBranch(supabase, input.modelId);
  if (!main?.head_commit_id) throw new Error('This model has no commits yet — there is nothing to base the baseline on.');
  const branch = await createChangeBranch(supabase, {
    id: crypto.randomUUID(),
    orgId: input.orgId,
    modelId: input.modelId,
    title: BASELINE_TITLE,
    createdBy: input.userId,
    mainHeadCommitId: main.head_commit_id,
    intent: 'explore',
    projectId: input.projectId,
  });
  const link = await createDecisionLink(supabase, { decisionId: input.decisionId, linkedType: 'branch', linkedId: branch.id, createdBy: input.userId });
  const decision = await updateDecision(supabase, input.decisionId, { baselineBranchId: branch.id });
  return { link, branch, decision };
}
