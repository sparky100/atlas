import type { UUID } from '../../contracts/delta';
import type { DecisionPrefill } from '../decisions/decisionPrefill';

export interface ProjectFormPrefill {
  title: string;
  purpose: string;
  /** `null` when the start didn't come from a health finding (the element page's own "Start a project…"). */
  sourceFindingKey: string | null;
  scope: { elementId: UUID; name: string }[];
}

/** F10 step 7: the element page's "Start a project…" — that element as the declared scope, its name as a starting title, no finding key. */
export function startProjectFromElementHref(projectsHref: string, element: { id: UUID; name: string }): string {
  const params = new URLSearchParams();
  params.set('startTitle', element.name);
  params.set('startStatement', '');
  params.set('startFindingKey', '');
  params.append('startElementId', element.id);
  params.append('startElementName', element.name);
  return `${projectsHref}?${params.toString()}`;
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
    sourceFindingKey: prefill.sourceFindingKey === '' ? null : prefill.sourceFindingKey,
    scope: prefill.linkedElements.map((e) => ({ elementId: e.id, name: e.name })),
  };
}
