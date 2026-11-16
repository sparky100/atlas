import type { ElementsHeadRow } from '../../../contracts/rows';
import { attributesRecord } from '../../../engine/elementRead/attributesRecord';
import { lifecycleStateOf } from '../../../engine/elementRead/fitAndExposure';
import type { LifecycleTagProps } from './LifecycleTag';

function dateAttribute(element: ElementsHeadRow, key: 'introduced' | 'plannedEnd'): string | undefined {
  const value = attributesRecord(element.attributes)[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** The tag props for `element` today, or `undefined` while it is active (an active element carries no tag). A module takes its platform's dates when it has none of its own. */
export function lifecycleTagFor(element: ElementsHeadRow, parent: ElementsHeadRow | null | undefined, now: Date = new Date()): LifecycleTagProps | undefined {
  const state = lifecycleStateOf(element, new Map(parent ? [[parent.element_id, parent]] : []), now);
  if (state === 'active') return undefined;
  return {
    state,
    introduced: dateAttribute(element, 'introduced') ?? (parent ? dateAttribute(parent, 'introduced') : undefined),
    plannedEnd: dateAttribute(element, 'plannedEnd') ?? (parent ? dateAttribute(parent, 'plannedEnd') : undefined),
  };
}
