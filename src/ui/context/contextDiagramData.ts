/**
 * V1's own platform/module data assembly for the Context diagram
 * (`useElementContext.ts`'s own caller) — grouping every candidate
 * platform's own modules and resolving each module's own capability chip,
 * the same "a platform's Container children are its modules" fact
 * `src/db/healthFindings.ts`'s `groupModulesByPlatformId` and
 * `src/ui/elements/useElementPage.ts`'s `moduleSupportsEdges` both already
 * read off `parent_id` — kept here rather than importing either of those
 * (one is a `src/db`-internal helper, the other is baked into a much
 * larger element-page loader) since this is the third, genuinely new
 * caller of the same small fact.
 */
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import type { UUID } from '../../contracts/delta';
import { attributesRecord } from '../elements/attributesRecord';
import { isPlatform } from '../elements/systemKind';

export interface ContextModule {
  elementId: UUID;
  name: string;
  capabilityName: string | null;
  /**
   * The module's own `lifecycleStatus` (`ContainerAttributes`, uninherited
   * from its platform — the same "a module's own, uninherited attributes
   * only" scope `layout.ts`'s own landscape placement already uses for a
   * module tile, per that decision's own reasoning: a module's tile tone is
   * a fact about *that module* alone, e.g. SAP BW itself recorded as
   * `retiring` while SAP as a whole stays `active`). `null` when the module
   * has never had one recorded.
   */
  lifecycleStatus: string | null;
}

/**
 * Every candidate system that is itself a platform with at least one
 * module, mapped to its own modules — a platform with no modules at all is
 * simply absent from the returned map, same "nothing to show" convention
 * `groupModulesByPlatformId` already uses. `useElementContext.ts`'s own
 * caller only ever passes `[hub]` — see that hook's own comment for why
 * this deliberately doesn't extend to a platform *neighbour* too — but
 * this function itself stays candidate-list-shaped rather than
 * hub-specific, the same "generic over what's actually passed in" shape
 * every other pure grouping function in this codebase already has.
 *
 * @param candidates Every system this diagram might need module data for — checked against `isPlatform`, not assumed.
 * @param containers Every `container` element the diagram's own commit/projection query already loaded (model-wide, cheap — `listContainersForLandscape`/`projectionContainersForLandscape`, the same query "platforms and modules" elsewhere in this codebase already uses).
 * @param supportsEdges `supports` edges touching any of those containers (`listRelationshipsTouchingAny`/`projectionRelationshipsTouchingAny`, scoped to the module ids actually found — never the whole model).
 * @param capabilitiesById Every capability those edges name, resolved by id.
 */
export function buildPlatformModulesById(
  candidates: readonly ElementsHeadRow[],
  containers: readonly ElementsHeadRow[],
  supportsEdges: readonly RelationshipsHeadRow[],
  capabilitiesById: ReadonlyMap<UUID, ElementsHeadRow>,
): Map<UUID, ContextModule[]> {
  const platformIds = new Set(candidates.filter(isPlatform).map((c) => c.element_id));
  if (platformIds.size === 0) return new Map();

  const modulesByPlatformId = new Map<UUID, ElementsHeadRow[]>();
  for (const container of containers) {
    if (container.parent_id === null || !platformIds.has(container.parent_id)) continue;
    const existing = modulesByPlatformId.get(container.parent_id);
    if (existing) existing.push(container);
    else modulesByPlatformId.set(container.parent_id, [container]);
  }
  if (modulesByPlatformId.size === 0) return new Map();

  // A module's own capability chip: its primary `supports` edge if it has
  // one, else the first found — a module normally supports exactly one
  // capability (the same `maxPrimaryPerFrom: 1` cardinality a system's own
  // supports edge carries), so "first found" only ever matters for
  // malformed/pre-migration data, never the ordinary case.
  const capabilityNameByModuleId = new Map<UUID, string>();
  for (const edge of supportsEdges) {
    if (edge.relationship_type !== 'supports') continue;
    const capability = capabilitiesById.get(edge.to_element_id);
    if (!capability) continue;
    const isPrimary = attributesRecord(edge.attributes).role === 'primary';
    if (isPrimary || !capabilityNameByModuleId.has(edge.from_element_id)) capabilityNameByModuleId.set(edge.from_element_id, capability.name);
  }

  const result = new Map<UUID, ContextModule[]>();
  for (const [platformId, modules] of modulesByPlatformId) {
    const sorted = [...modules].sort((a, b) => a.name.localeCompare(b.name) || a.element_id.localeCompare(b.element_id));
    result.set(
      platformId,
      sorted.map((module) => {
        const lifecycleStatus = attributesRecord(module.attributes).lifecycleStatus;
        return {
          elementId: module.element_id,
          name: module.name,
          capabilityName: capabilityNameByModuleId.get(module.element_id) ?? null,
          lifecycleStatus: typeof lifecycleStatus === 'string' ? lifecycleStatus : null,
        };
      }),
    );
  }
  return result;
}
