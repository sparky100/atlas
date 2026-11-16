/**
 * Split out from RelationshipAdd.tsx so it can be unit-tested with no
 * Supabase client in the import graph at all — same reason
 * src/ui/orgs/roleGates.ts's own module comment gives for its split:
 * RelationshipAdd.tsx pulls in useRelationshipCreate.ts, which pulls in
 * src/ui/supabaseClient.ts, which throws at import time without
 * VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY set — exactly the environment a
 * plain `vitest run` unit test doesn't have.
 */
import type { ActorAttributes, ElementType, RelationshipType } from '../../../contracts/delta';
import type { Json } from '../../../contracts/rows';

/**
 * The attributes a picked target gets when no staged prompt (RelationshipAdd.tsx's
 * primary/label/owns-role questions) intercepts it first (Sprint U4-1 B5
 * bugfix, extended by Prompt 7k item 2). This used to be a literal
 * `{ role: 'secondary' }` in `pickResult` itself, unconditionally — correct
 * for `supports`' own first-link-or-inbound case, but wrong for `owns`:
 * before item 2, `role` wasn't an `OwnsAttributes` key at all, so an owner
 * added through this control got an edge with no ownership attribute set.
 * `uses`/`flows_to` never reach this function any more — RelationshipAdd's
 * `needsLabel` intercepts them first.
 *
 * `owns` only reaches here for a *capability* target — a system or
 * container target is always intercepted by RelationshipAdd's own staged
 * "which role?" prompt (item 1's "defaults to business on capability
 * targets, prompts on system targets" — a module target gets the same
 * prompt a system target does, see RelationshipAdd's own doc comment; the
 * default below is that capability-target default; `ownedElementType` is
 * `undefined` only for a relationship type that never needs it, i.e. never
 * `owns`, so this being undefined for an `owns` call would be a caller bug,
 * not a legitimate case to silently fall through). `owns` on a system or
 * container target instead returns `undefined` from here (defensive;
 * RelationshipAdd's own staging should have already intercepted it),
 * letting `useRelationshipCreate`'s own bare fallback (`{ role: 'business'
 * }`) apply — the same default this function would have returned anyway.
 */
export function defaultAttributesForPlainPick(relationshipType: RelationshipType, ownedElementType?: ElementType): Record<string, Json> | undefined {
  if (relationshipType === 'supports') return { role: 'secondary' };
  if (relationshipType === 'owns' && ownedElementType === 'capability') return { role: 'business' };
  return undefined;
}

/** The type choices offered when an owner is added inline from the owned-by picker. */
export type NewOwnerKind = 'organisation' | 'team' | 'person';

export const NEW_OWNER_KINDS: readonly { key: NewOwnerKind; label: string }[] = [
  { key: 'organisation', label: 'Organisation' },
  { key: 'team', label: 'Team' },
  { key: 'person', label: 'Person' },
];

/**
 * Attributes for an actor created inline from an owned-by picker. An
 * organisation is always outside ours (so its `owns` edge is forced to
 * `service`, C20); a team or person defaults to inside, unless the user
 * ticks "Outside our organisation".
 */
export function newOwnerAttributes(kind: NewOwnerKind, outside: boolean): Pick<ActorAttributes, 'subtype' | 'isExternal'> {
  return { subtype: kind, isExternal: kind === 'organisation' ? true : outside };
}

/** Whether `typed` already names a result exactly (case-insensitive), so no "add as new" option is offered for it. */
export function hasExactNameMatch(typed: string, names: readonly string[]): boolean {
  const wanted = typed.trim().toLowerCase();
  return names.some((name) => name.trim().toLowerCase() === wanted);
}
