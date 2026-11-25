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

export interface ProjectStart {
  /** Overrides the element-type default title. */
  title?: string;
  /** Overrides the element-type default purpose. */
  purpose?: string;
  /** A stable health-finding key, when a finding is behind this start. */
  findingKey?: string;
}

/** The project voice for a generic element start (the element page's ⋯ menu). */
export function projectStartForElement(element: { name: string; type?: ElementType }): { title: string; purpose: string } {
  if (element.type === 'capability') {
    return {
      title: `Meet ${element.name}`,
      purpose: `Work out what ${element.name} needs, who relies on it, and which option to investigate — extend, buy or build.`,
    };
  }
  if (element.type === 'system' || element.type === 'container') {
    return {
      title: `Decide the future of ${element.name}`,
      purpose: `Work out whether to keep, extend, replace or retire ${element.name}, and what evidence is needed.`,
    };
  }
  return { title: element.name, purpose: '' };
}

/** F10 step 7: the element page's "Start a project…" — that element as the declared scope, with a project-shaped title and purpose. The element's type rides along so the form (plan A1) knows whether a capability is already named. */
export function startProjectFromElementHref(projectsHref: string, element: { id: UUID; name: string; type?: ElementType }, start: ProjectStart = {}): string {
  const defaults = projectStartForElement(element);
  const params = new URLSearchParams();
  params.set('startTitle', start.title ?? defaults.title);
  params.set('startStatement', start.purpose ?? defaults.purpose);
  params.set('startFindingKey', start.findingKey ?? '');
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
    title: prefill.projectTitle ?? prefill.title.replace(/\?\s*$/, ''),
    purpose: prefill.projectStatement ?? prefill.statement,
    sourceFindingKey: prefill.sourceFindingKey === '' ? null : prefill.sourceFindingKey,
    scope: prefill.linkedElements.map((e) => (e.type ? { elementId: e.id, name: e.name, elementType: e.type } : { elementId: e.id, name: e.name })),
  };
}
