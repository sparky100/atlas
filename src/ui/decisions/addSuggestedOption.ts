import type { UUID } from '../../contracts/delta';
import { optionWasEdited, type DecisionOptionMark } from '../../contracts/decisionOptionMark';
import { createChangeBranch, getBranch, getMainBranch } from '../../db/branches';
import { createDecisionLink, listDecisionLinksForDecision } from '../../db/decisions';
import { insertOptionMark, listOptionMarksForDecision, markOptionEdited } from '../../db/decisionOptionMarks';
import { addOptionWithCatalogueSources } from '../../db/productCatalogue';
import type { BranchRow, DecisionLinkRow } from '../../db/types';
import { supabase } from '../supabaseClient';
import { optionDescription, type PendingOption } from './pendingOptions';

export interface AddSuggestedOptionInput {
  orgId: UUID;
  modelId: UUID;
  decisionId: UUID;
  userId: UUID;
  projectId: UUID | null;
  option: PendingOption;
}

export interface AddedSuggestedOption {
  branch: BranchRow;
  link: DecisionLinkRow;
}

/**
 * Saves one suggested option as a real option on the decision: an
 * explore-intent change branch whose id is the card's own id, linked to the
 * decision, then its provenance mark. The three writes are each skipped if
 * already done, so a retry after a failure or a double click completes the
 * option instead of duplicating it. The mark says the Designer drafted it and,
 * when the person changed it first, that they edited it.
 */
export async function addSuggestedOption(input: AddSuggestedOptionInput): Promise<AddedSuggestedOption> {
  const { option } = input;
  let branch = await getBranch(supabase, option.id);
  if (branch === null) {
    const main = await getMainBranch(supabase, input.modelId);
    if (!main?.head_commit_id) throw new Error('This model has no commits yet, so there is nothing to base an option on.');
    branch = await createChangeBranch(supabase, {
      id: option.id,
      orgId: input.orgId,
      modelId: input.modelId,
      title: option.title.trim(),
      description: optionDescription(option),
      createdBy: input.userId,
      mainHeadCommitId: main.head_commit_id,
      intent: 'explore',
      projectId: input.projectId,
    });
  }
  const links = await listDecisionLinksForDecision(supabase, input.decisionId);
  // With reviewed catalogue products, the link, Designer mark, edit stamp and
  // citations are saved in one database transaction. Without them, the
  // existing three writes are unchanged.
  const refs = option.catalogueRefs;
  if (refs.length > 0) {
    const edited = optionWasEdited({ suggestedTitle: option.suggestedTitle, suggestedSummary: option.suggestedSummary }, option.title, option.summary);
    const mark: DecisionOptionMark = {
      decisionId: input.decisionId, branchId: option.id, agent: 'designer', draftedAt: option.draftedAt, draftRunId: null,
      suggestedTitle: option.suggestedTitle, suggestedSummary: option.suggestedSummary,
      editedBy: edited ? input.userId : null, editedAt: edited ? new Date().toISOString() : null,
    };
    await addOptionWithCatalogueSources(supabase, mark, refs);
    const saved = (await listDecisionLinksForDecision(supabase, input.decisionId)).find((l) => l.linked_type === 'branch' && l.linked_id === option.id);
    if (!saved) throw new Error('The option was saved, but its link to the decision could not be read back.');
    return { branch, link: saved };
  }
  const link = links.find((l) => l.linked_type === 'branch' && l.linked_id === option.id) ?? (await createDecisionLink(supabase, { decisionId: input.decisionId, linkedType: 'branch', linkedId: option.id, createdBy: input.userId }));
  const marks = await listOptionMarksForDecision(supabase, input.decisionId);
  if (!marks.some((m) => m.branchId === option.id)) {
    await insertOptionMark(supabase, { decisionId: input.decisionId, branchId: option.id, agent: 'designer', draftedAt: option.draftedAt, draftRunId: null, suggestedTitle: option.suggestedTitle, suggestedSummary: option.suggestedSummary, editedBy: null, editedAt: null, createdBy: input.userId });
    if (optionWasEdited({ suggestedTitle: option.suggestedTitle, suggestedSummary: option.suggestedSummary }, option.title, option.summary)) {
      await markOptionEdited(supabase, { decisionId: input.decisionId, branchId: option.id, editedBy: input.userId, editedAt: new Date().toISOString() });
    }
  }
  return { branch, link };
}
