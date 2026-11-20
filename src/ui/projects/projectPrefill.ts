import type { ElementType, UUID } from '../../contracts/delta';
import type { DecisionPrefill } from '../decisions/decisionPrefill';
import type { ProjectScopeItem } from './projectModel';

export interface ProjectFormPrefill {
  title: string;
  purpose: string;
  /** `null` when the start didn't come from a health finding (the element page's own "Start a project…"). */
  sourceFindingKey: string | null;
  scope: ProjectScopeItem[];
}

/** F10 step 7: the element page's "Start a project…" — that element as the declared scope, its name as a starting title, no finding key. The element's type rides along so the form (plan A1) knows whether a capability is already named. */
export function startProjectFromElementHref(projectsHref: string, element: { id: UUID; name: string; type?: ElementType }, purpose = ''): string {
  const params = new URLSearchParams();
  params.set('startTitle', element.name);
  params.set('startStatement', purpose);
  params.set('startFindingKey', '');
  params.append('startElementId', element.id);
  params.append('startElementName', element.name);
  params.append('startElementType', element.type ?? '');
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
    scope: prefill.linkedElements.map((e) => (e.type ? { elementId: e.id, name: e.name, elementType: e.type } : { elementId: e.id, name: e.name })),
  };
}
