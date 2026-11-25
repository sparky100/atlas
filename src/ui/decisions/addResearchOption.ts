import type { UUID } from '../../contracts/delta';
import type { WebResearchCandidate } from '../../contracts/webResearch';
import { createChangeBranch, getBranch, getMainBranch } from '../../db/branches';
import { createDecisionLink, listDecisionLinksForDecision } from '../../db/decisions';
import { getDecisionOptionForBranch } from '../../db/decisionOptions';
import { insertOptionWebSource } from '../../db/optionWebSources';
import type { BranchRow, DecisionLinkRow } from '../../db/types';
import { supabase } from '../supabaseClient';
import { researchOptionDescription, researchOptionTitle } from './researchOptionText';

export interface AddResearchOptionInput {
  orgId: UUID;
  modelId: UUID;
  decisionId: UUID;
  userId: UUID;
  projectId: UUID | null;
  candidate: WebResearchCandidate;
  /** Stable for one card, so a retry after a partial failure finishes the same option instead of duplicating it. */
  optionId?: UUID;
}

export interface AddResearchOptionResult {
  branch: BranchRow;
  link: DecisionLinkRow;
  /** The option exists, but its page could not be saved with it. Shown to the person, never hidden. */
  sourceError: string | null;
}

/**
 * Turns a returned web page into a real option: an explore-intent change
 * branch linked to the decision, with the page saved as an unreviewed web
 * source. It is not a Designer suggestion, so it carries no Designer mark.
 *
 * The branch and link are created first because the source row requires them.
 * A source failure does not undo the option; it is returned as a warning so
 * the person can open the option and save the page there.
 */
export async function addResearchOption(input: AddResearchOptionInput): Promise<AddResearchOptionResult> {
  const title = researchOptionTitle(input.candidate);
  const optionId = input.optionId ?? crypto.randomUUID();
  let branch = await getBranch(supabase, optionId);
  if (branch === null) {
    const main = await getMainBranch(supabase, input.modelId);
    if (!main?.head_commit_id) throw new Error('This model has no commits yet, so there is nothing to base an option on.');
    branch = await createChangeBranch(supabase, {
      id: optionId,
      orgId: input.orgId,
      modelId: input.modelId,
      title,
      description: researchOptionDescription(input.candidate),
      createdBy: input.userId,
      mainHeadCommitId: main.head_commit_id,
      intent: 'explore',
      projectId: input.projectId,
    });
  }

  const links = await listDecisionLinksForDecision(supabase, input.decisionId);
  const link = links.find((l) => l.linked_type === 'branch' && l.linked_id === branch.id)
    ?? (await createDecisionLink(supabase, { decisionId: input.decisionId, linkedType: 'branch', linkedId: branch.id, createdBy: input.userId }));

  let sourceError: string | null = null;
  try {
    // The link's trigger created the candidate row; the page belongs to it.
    const option = await getDecisionOptionForBranch(supabase, input.decisionId, branch.id);
    if (option === null) throw new Error('The option was saved, but it could not be read back to attach the page.');
    await insertOptionWebSource(supabase, {
      decisionId: input.decisionId,
      optionId: option.id,
      branchId: branch.id,
      candidate: input.candidate,
      citedBy: input.userId,
    });
  } catch (e) {
    sourceError = e instanceof Error && e.message !== '' ? e.message : 'The page could not be saved with the option.';
  }

  return { branch, link, sourceError };
}
