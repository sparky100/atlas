/**
 * "Platforms and modules" on the Roadmap: a platform's own `Container`
 * children (modules) can carry the same lifecycle dates
 * (`introduced`/`plannedEnd`/`supportEndsAt`) and inheritable fields
 * (`lifecycleStatus`/`criticality`) a `system` can — `roadmapLifecycleRows.ts`'s
 * own module comment already says so ("Lifecycle dates live on systems and
 * containers only") — but `useRoadmap.ts` only ever fetched
 * `element_type === 'system'`, so a module's own bar (e.g. a retiring
 * platform module with a real planned-end date) never appeared on the
 * timeline at all. This is the fix: every system *and* module, with a
 * module's inheritable attributes resolved against its platform parent
 * when unset (`effectiveModuleAttributes.ts`'s own module comment names
 * "the module's own element-page display" as a consumer — a roadmap bar
 * is exactly that, same as the element page's "(module override)" fields),
 * and its name relabelled "{platform} · {module}" (`moduleDisplayName.ts`)
 * so a bare module name never appears out of context on the timeline —
 * the same convention `landscapeModules.ts`'s own `withModuleLabels` uses
 * for Landscape.
 */
import type { ElementsHeadRow } from '../../contracts/rows';
import { effectiveModuleAttributes } from '../elements/moduleAttributes';
import { moduleDisplayName } from '../elements/moduleDisplayName';

/**
 * Every system and module in `elements`, ready for `groupRoadmapLifecycleBars`.
 * A module whose parent isn't a live system in `elements` (or has none) is
 * returned with its own, uninherited attributes and name unchanged — the
 * same fallback `moduleDisplayName`/`effectiveModuleAttributes` already
 * take on their own.
 */
export function systemsAndModulesFor(elements: readonly ElementsHeadRow[]): ElementsHeadRow[] {
  const elementsById = new Map(elements.map((e) => [e.element_id, e]));
  return elements
    .filter((e) => e.element_type === 'system' || e.element_type === 'container')
    .map((e) => {
      if (e.element_type !== 'container' || e.parent_id === null) return e;
      const parent = elementsById.get(e.parent_id) ?? null;
      const withAttributes = parent ? effectiveModuleAttributes(e, parent) : e;
      const name = moduleDisplayName(withAttributes, parent);
      return name === withAttributes.name ? withAttributes : { ...withAttributes, name };
    });
}
