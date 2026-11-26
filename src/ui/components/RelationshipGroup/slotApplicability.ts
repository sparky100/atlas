/**
 * Split out from RelationshipsSection.tsx/RelationshipAdd.tsx so it can be
 * unit-tested with no Supabase client in the import graph (same reason
 * `relationshipAddDefaults.ts`'s module comment gives).
 *
 * `RELATIONSHIP_TYPE_RULES` only knows (relationshipType, fromType, toType),
 * so a few commit-time invariants that depend on the element itself
 * (C20, C22) can't shape the "+ Add" slots it produces. These helpers
 * apply them in the UI so a user is never offered an add the engine will
 * reject at commit.
 */
import type { ElementType, OwnsRole, RelationshipType } from '../../../contracts/delta';
import type { Json } from '../../../contracts/rows';

/**
 * C22: an `enables` edge's target must be a stage (a `value_stream` with a
 * non-null parent), never a stream. So the inbound `enables` slot is only
 * applicable to a stage — a top-level stream (`parentId === null`) can
 * never be the target of one. Every other slot is unaffected.
 */
export function isSlotApplicable(relationshipType: RelationshipType, direction: 'outbound' | 'inbound', elementType: ElementType, parentId: string | null, isPlatformKind = false): boolean {
  // A `platform`-kind system never supports a capability itself — its modules do (`relationshipTypeRules.ts`'s `(supports, container, capability)` row comment). Rows already recorded still show.
  // system-only: a platform is a whole system; its modules do support capabilities.
  if (relationshipType === 'supports' && direction === 'outbound' && elementType === 'system' && isPlatformKind) return false;
  if (relationshipType === 'enables' && direction === 'inbound' && elementType === 'value_stream') return parentId !== null;
  return true;
}

/**
 * C20: an `owns` edge whose owning actor is external must carry
 * `role: 'service'`. The actor is the `outbound` side of `owns`; returns
 * `'service'` when the add must skip the role question and use it, else
 * `undefined` (the usual role flow applies).
 */
export function forcedOwnsRole(relationshipType: RelationshipType, direction: 'outbound' | 'inbound', ownerIsExternal: boolean): OwnsRole | undefined {
  return relationshipType === 'owns' && direction === 'outbound' && ownerIsExternal ? 'service' : undefined;
}

export function forcedOwnsAttributes(relationshipType: RelationshipType, direction: 'outbound' | 'inbound', ownerIsExternal: boolean): Record<string, Json> | undefined {
  const role = forcedOwnsRole(relationshipType, direction, ownerIsExternal);
  return role === undefined ? undefined : { role };
}
