/**
 * "Platforms and modules": a platform system's own `Container` children
 * are its modules — each may set its own `lifecycleStatus`/`criticality`/
 * `hostingModel`/`hostingProvider`/`domain` (`ContainerAttributes`'s own
 * doc comment, `src/contracts/delta.ts`), overriding the platform's value;
 * when a module leaves one of these unset, it *effectively* reads as the
 * platform's own value instead. This is deliberately not a blind object
 * spread of the platform's attributes onto the module's: that would leak
 * `kind: 'platform'` onto the module's own effective attributes, which
 * would corrupt `kindOf`/`isNonApplicationKind`/`isPlatform` wherever
 * later called on the "effective" row — a module must never itself read
 * as a platform. This is an explicit allow-list of exactly the five
 * fields the feature names, nothing else.
 *
 * Consumed only where capability-map coverage/exposure metrics and the
 * module's own element-page display read a module's attributes
 * (`src/ui/capabilityMap/useCapabilityMap.ts`) — deliberately *not* by
 * landscape zoning, which reads a module's own (uninherited) attributes
 * only (`src/ui/landscape/layout.ts`'s `placementFor`, unchanged), so an
 * OT-zoned platform never silently pulls its modules into the OT zone too.
 */
import type { ElementsHeadRow, Json } from '../../contracts/rows';
import { attributesRecord } from './attributesRecord';

const INHERITABLE_KEYS = ['lifecycleStatus', 'criticality', 'hostingModel', 'hostingProvider', 'domain'] as const;

/**
 * `module`, with each of the five inheritable keys resolved to the
 * module's own value if set, else the platform's — every other attribute
 * (`isExternal`, `kind` — a module never has one — `description`,
 * `technology`, `introduced`, `plannedEnd`) is the module's own, untouched.
 */
export function effectiveModuleAttributes(module: ElementsHeadRow, platform: ElementsHeadRow): ElementsHeadRow {
  const moduleAttrs = attributesRecord(module.attributes);
  const platformAttrs = attributesRecord(platform.attributes);
  const effective: Record<string, Json> = { ...moduleAttrs };
  for (const key of INHERITABLE_KEYS) {
    if (moduleAttrs[key] === undefined || moduleAttrs[key] === null) {
      const platformValue = platformAttrs[key];
      if (platformValue !== undefined) effective[key] = platformValue;
    }
  }
  return { ...module, attributes: effective };
}
