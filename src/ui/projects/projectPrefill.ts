import type { UUID } from '../../contracts/delta';
import type { DecisionPrefill } from '../decisions/decisionPrefill';

export interface ProjectFormPrefill {
  title: string;
  purpose: string;
  sourceFindingKey: string;
  scope: { elementId: UUID; name: string }[];
}

/**
 * F10 step 7: "Start a project" reuses the decision prefill's URL format
 * (`decisionPrefillToSearchParams` — a finding's title, context, stable
 * finding key and elements). A project is named for the work rather than
 * the question, so a trailing "?" is dropped from the title; the context
 * becomes the purpose and the elements the declared scope.
 */
export function projectFormFromPrefill(prefill: DecisionPrefill): ProjectFormPrefill {
  return {
    title: prefill.title.replace(/\?\s*$/, ''),
    purpose: prefill.statement,
    sourceFindingKey: prefill.sourceFindingKey,
    scope: prefill.linkedElements.map((e) => ({ elementId: e.id, name: e.name })),
  };
}
