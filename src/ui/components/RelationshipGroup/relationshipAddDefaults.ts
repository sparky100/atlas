/**
 * Split out from RelationshipAdd.tsx so it can be unit-tested with no
 * Supabase client in the import graph at all — same reason
 * src/ui/orgs/roleGates.ts's own module comment gives for its split:
 * RelationshipAdd.tsx pulls in useRelationshipCreate.ts, which pulls in
 * src/ui/supabaseClient.ts, which throws at import time without
 * VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY set — exactly the environment a
 * plain `vitest run` unit test doesn't have.
 */
import type { RelationshipType } from '../../../contracts/delta';
import type { Json } from '../../../contracts/rows';

/**
 * The attributes a picked target gets when neither the primary-prompt nor
 * the verb-label prompt (RelationshipAdd.tsx) intercepts it first (Sprint
 * U4-1 B5 bugfix). This used to be a literal `{ role: 'secondary' }` in
 * `pickResult` itself, unconditionally — correct for `supports`' own
 * first-link-or-inbound case, but wrong for `owns`: `role` isn't an
 * `OwnsAttributes` key at all, so an owner added through this control
 * (reachable today — `owns` has real outbound/inbound groups,
 * relationshipTypeRules.ts) got an edge with no `primary` value set,
 * silently never counting as anyone's owner (`findCapabilitiesWithoutOwner`,
 * `checkPrimaryCardinality`'s C17 both key off `attributes.primary`).
 * `uses`/`flows_to` never reach this function at all any more —
 * RelationshipAdd's `needsLabel` intercepts them first — so today this
 * only ever returns something for `supports`; `owns` (and anything else
 * added later) falls through to `undefined`, letting
 * `useRelationshipCreate`'s own per-type default (`{ primary: true }` for
 * `owns`) apply instead of this control inventing one.
 */
export function defaultAttributesForPlainPick(relationshipType: RelationshipType): Record<string, Json> | undefined {
  return relationshipType === 'supports' ? { role: 'secondary' } : undefined;
}
