import type { UUID } from '../../contracts/delta';
import { optionWasEdited } from '../../contracts/decisionOptionMark';
import { addDesignerCandidate } from '../../db/decisionOptions';
import type { DecisionOptionRow } from '../../db/types';
import { supabase } from '../supabaseClient';
import { citationsToNames } from '../../db/designAgent';
import type { PendingOption } from './pendingOptions';

export interface AddSuggestedOptionInput {
  decisionId: UUID;
  userId: UUID;
  option: PendingOption;
}

/**
 * Saves one suggested option as a candidate on the decision (item 2 of the
 * 25 Nov review): no change is made until a person presses "Work on this
 * option". The candidate's id is the card's own id, and the save is one
 * database transaction that also records "Suggested by the Designer" (and,
 * when the person changed it first, that they edited it) and any reviewed
 * catalogue products, so a retry after a failure or a double click
 * completes the option instead of duplicating it.
 */
export async function addSuggestedOption(input: AddSuggestedOptionInput): Promise<DecisionOptionRow> {
  const { option } = input;
  const edited = optionWasEdited({ suggestedTitle: option.suggestedTitle, suggestedSummary: option.suggestedSummary }, option.title, option.summary);
  return addDesignerCandidate(supabase, {
    decisionId: input.decisionId,
    id: option.id,
    title: option.title,
    summary: citationsToNames(option.summary.trim(), {}),
    toWeigh: citationsToNames(option.toWeigh.trim(), {}),
    approach: option.approach ?? null,
    draftedAt: option.draftedAt,
    editedBy: edited ? input.userId : null,
    editedAt: edited ? new Date().toISOString() : null,
    catalogueRefs: option.catalogueRefs,
  });
}
