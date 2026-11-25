import type { UUID } from '../../contracts/delta';
import type { WebResearchCandidate } from '../../contracts/webResearch';
import { createDecisionOption, getDecisionOption } from '../../db/decisionOptions';
import { insertOptionWebSource } from '../../db/optionWebSources';
import type { DecisionOptionRow } from '../../db/types';
import { supabase } from '../supabaseClient';
import { researchOptionDescription, researchOptionTitle } from './researchOptionText';

export interface AddResearchOptionInput {
  decisionId: UUID;
  userId: UUID;
  candidate: WebResearchCandidate;
  /** Stable for one card, so a retry after a partial failure finishes the same option instead of duplicating it. */
  optionId?: UUID;
}

export interface AddResearchOptionResult {
  option: DecisionOptionRow;
  /** The option exists, but its page could not be saved with it. Shown to the person, never hidden. */
  sourceError: string | null;
}

/**
 * Turns a returned web page into a candidate option, with the page saved as
 * an unreviewed web source on it. No change is made until a person presses
 * "Work on this option" (item 2 of the 25 Nov review). It is not a Designer
 * suggestion, so it carries no Designer mark.
 *
 * A source failure does not undo the option; it is returned as a warning so
 * the person can research the option again and save the page there.
 */
export async function addResearchOption(input: AddResearchOptionInput): Promise<AddResearchOptionResult> {
  const optionId = input.optionId ?? crypto.randomUUID();
  const option = (await getDecisionOption(supabase, optionId)) ?? (await createDecisionOption(supabase, {
    id: optionId,
    decisionId: input.decisionId,
    title: researchOptionTitle(input.candidate),
    summary: researchOptionDescription(input.candidate).slice(0, 2000),
    createdBy: input.userId,
  }));

  let sourceError: string | null = null;
  try {
    await insertOptionWebSource(supabase, {
      decisionId: input.decisionId,
      optionId: option.id,
      branchId: null,
      candidate: input.candidate,
      citedBy: input.userId,
    });
  } catch (e) {
    const message = e instanceof Error && e.message !== '' ? e.message : 'The page could not be saved with the option.';
    // A retry after the page was already saved is not a failure.
    sourceError = message.includes('already saved') ? null : message;
  }

  return { option, sourceError };
}
