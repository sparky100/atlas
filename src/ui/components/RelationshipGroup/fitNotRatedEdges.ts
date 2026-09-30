/**
 * The "fit not rated" soft prompt's own display rule — pulled out of
 * `RelationshipsSection.tsx` so it's unit-testable without mounting a
 * component. A capability's primary supporter having no `fitForPurpose`
 * value recorded looked the same as "not applicable" (no chip either
 * way) — this says so instead, on the capability page's own inbound
 * `supports` group only, scoped to exactly the edges
 * `fitAssessmentSupportsEdges` (`capabilityMap/metrics.ts`) says count
 * toward the capability's fit assessment: its primary edges when at
 * least one exists, or its secondary edges only as a fallback when it
 * has none. A secondary edge on a capability that already has a primary
 * one is never eligible, even if its own `fitForPurpose` is unset.
 */
import type { ElementType, UUID } from '../../../contracts/delta';
import type { RelationshipsHeadRow } from '../../../contracts/rows';
import { fitAssessmentSupportsEdges } from '../../capabilityMap/metrics';
import { attributesRecord } from '../../elements/attributesRecord';
import { isFitForPurpose } from '../../elements/fitForPurposeTone';

function hasFitForPurpose(edge: RelationshipsHeadRow): boolean {
  const value = attributesRecord(edge.attributes).fitForPurpose;
  return typeof value === 'string' && isFitForPurpose(value);
}

/**
 * The relationship_ids, among `rows`, that should show the "fit not
 * rated" prompt — empty unless `direction` is `'inbound'`, `elementType`
 * is `'capability'`, and `rows` is that capability's own `supports`
 * group (the shape `RelationshipsSection.tsx`'s own `inboundRows` for
 * the `supports` type already is).
 */
export function fitNotRatedRelationshipIds(direction: 'outbound' | 'inbound', elementType: ElementType, capabilityId: UUID, rows: readonly RelationshipsHeadRow[]): ReadonlySet<UUID> {
  if (direction !== 'inbound' || elementType !== 'capability' || rows.length === 0 || rows[0]?.relationship_type !== 'supports') return new Set();
  const { edges } = fitAssessmentSupportsEdges(capabilityId, rows);
  return new Set(edges.filter((edge) => !hasFitForPurpose(edge)).map((edge) => edge.relationship_id));
}
