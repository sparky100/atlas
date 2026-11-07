/**
 * "Owners by role" for the shared Inspector's Selection section (V2b) —
 * every live `owns` edge targeting a given element, grouped by role
 * (`business`/`technical`/`service`, `relationshipAttributeSchema.ts`'s
 * `OWNS_ROLE_OPTIONS`), owner resolved via an actor lookup (an `owns`
 * edge's own `from` is always an actor, `relationshipTypeRules.ts` — a
 * system or a capability can both be an `owns` edge's `to`, so this takes
 * no element-type-specific input at all). Extracted from
 * `src/ui/landscape/landscapeInspectorSelection.ts` once the capability
 * map's own Inspector needed the identical grouping for a capability
 * target — same "extracted once a second caller needed it" history
 * `criticalityTone.ts`/`lifecycleTone.ts` already have.
 */
import type { UUID } from '../../contracts/delta';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import { attributesRecord } from './attributesRecord';

export function ownersByRole(targetId: UUID, ownsEdges: readonly RelationshipsHeadRow[], actorsById: ReadonlyMap<UUID, ElementsHeadRow>): Map<string, ElementsHeadRow[]> {
  const byRole = new Map<string, ElementsHeadRow[]>();
  for (const edge of ownsEdges) {
    if (edge.to_element_id !== targetId) continue;
    const owner = actorsById.get(edge.from_element_id);
    if (!owner) continue;
    const role = attributesRecord(edge.attributes).role;
    const key = typeof role === 'string' ? role : 'other';
    const existing = byRole.get(key);
    if (existing) existing.push(owner);
    else byRole.set(key, [owner]);
  }
  return byRole;
}
