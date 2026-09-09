/**
 * Commit titles (Sprint U4-1 B1). `commits.title` used to be whatever
 * string the calling hook happened to type by hand ("Add relationship",
 * `Edit ${element.name}`) — accurate about the *kind* of change, useless
 * about its actual content. `describeEnvelope` generates the title from the
 * deltas themselves, using real element and relationship names, the same
 * way `elements_head`/`relationships_head` are themselves a materialised
 * *projection* of the deltas rather than something typed by hand.
 *
 * `nameLookup` resolves an *element* id to its current name — the name as
 * of just before this commit, which is exactly what every real caller
 * already has in hand (the page's already-loaded element/endpoint data)
 * before it ever builds the envelope. It cannot resolve a *relationship*
 * id to anything, because nothing does: relationships have no name of
 * their own, and `relationship.retract`/`relationship.restore`/
 * `relationship.update` carry only `relationshipId` — not the endpoint ids
 * needed to say "PowerON supports Outage & Fault Management" — so those
 * three kinds fall back to a generic, type-only description. This is a
 * real constraint of what the delta itself carries, not a shortcut: giving
 * those kinds a richer title would mean threading a second, relationship-
 * scoped lookup through every caller for three kinds nothing produces yet
 * (no hook retracts, restores, or updates a relationship as of this
 * sprint — B4's `supports.role` will be the first `relationship.update`
 * producer).
 */
import type { Delta, ElementType, RelationshipType, UUID } from '../contracts/delta';
import type { Json } from '../contracts/rows';
import { attributeFieldSchema } from '../contracts/attributeSchema';

export type NameLookup = (elementId: UUID) => string | undefined;

const UNKNOWN_NAME = '(unknown)';

function resolveName(nameLookup: NameLookup, elementId: UUID): string {
  return nameLookup(elementId) ?? UNKNOWN_NAME;
}

/** The outbound verb for a relationship type, e.g. "PowerON **supports** Outage & Fault Management" — same wording as `RelationshipsSection.tsx`'s/`RelationshipAdd.tsx`'s own `outbound` label, kept here as the engine's own copy since neither UI file exports one and this module cannot import from `src/ui`. */
const RELATIONSHIP_VERB: Record<RelationshipType, string> = {
  supports: 'supports',
  owns: 'owns',
  uses: 'uses',
  flows_to: 'flows to',
};

/** camelCase -> "space separated lower case", for a relationship attribute key — relationships have no curated label schema the way `ATTRIBUTE_SCHEMA_BY_TYPE` gives elements (src/contracts/attributeSchema.ts), so this is the honest fallback rather than a hand-maintained list that drifts out of sync with `RelationshipAttributesByType`. */
function humanizeKey(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
}

/** `element.update`/`relationship.update` values are typed `X | null` per-attribute (`ElementAttributeValue`/`RelationshipAttributeValue`, src/contracts/delta.ts), but an *optional* attribute's own type union still includes `undefined` — nothing actually sends `undefined` over the wire (`toDeltaRow` always writes an explicit jsonb `null`), but this function's input type has to admit it regardless. */
function isEmpty(value: Json | undefined): value is null | undefined {
  return value === null || value === undefined;
}

function formatValue(value: Json): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return JSON.stringify(value);
}

function describeElementUpdate(elementType: ElementType, elementId: UUID, attribute: string, value: Json | undefined, nameLookup: NameLookup): string {
  const name = resolveName(nameLookup, elementId);
  if (attribute === 'name') return `Rename ${name} to ${isEmpty(value) ? '' : formatValue(value)}`;
  if (attribute === 'parentId') {
    return isEmpty(value) ? `Move ${name} to top level` : `Move ${name} to ${resolveName(nameLookup, value as UUID)}`;
  }
  const label = (attributeFieldSchema(elementType, attribute)?.label ?? humanizeKey(attribute)).toLowerCase();
  return isEmpty(value) ? `Clear ${name} ${label}` : `Set ${name} ${label} to ${formatValue(value)}`;
}

function describeRelationshipCreate(relationshipType: RelationshipType, fromElementId: UUID, toElementId: UUID, nameLookup: NameLookup): string {
  const from = resolveName(nameLookup, fromElementId);
  const to = resolveName(nameLookup, toElementId);
  // `owns` reads far more naturally as "Set X owner to Y" than "Link Y owns
  // X" — the one relationship type with product-facing "ownership"
  // language of its own (RelationshipsSection.tsx's "owned by"/★ primary
  // owner), everything else just names the verb.
  if (relationshipType === 'owns') return `Set ${to} owner to ${from}`;
  return `Link ${from} ${RELATIONSHIP_VERB[relationshipType]} ${to}`;
}

/** One delta's own title, ignoring every other delta in its commit — `describeEnvelope` uses this directly for a single-delta commit, and as the "gist" half of a multi-delta one. */
function describeDelta(delta: Delta, nameLookup: NameLookup): string {
  switch (delta.kind) {
    case 'element.create':
      return `Add ${delta.elementType} ${delta.name}`;
    case 'element.update':
      return describeElementUpdate(delta.elementType, delta.elementId, delta.attribute, delta.value, nameLookup);
    case 'element.retract':
      return `Retract ${resolveName(nameLookup, delta.elementId)}`;
    case 'element.restore':
      return `Restore ${resolveName(nameLookup, delta.elementId)}`;
    case 'relationship.create':
      return describeRelationshipCreate(delta.relationshipType, delta.fromElementId, delta.toElementId, nameLookup);
    case 'relationship.update': {
      const label = humanizeKey(delta.attribute);
      return isEmpty(delta.value) ? `Clear ${delta.relationshipType} ${label}` : `Set ${delta.relationshipType} ${label} to ${formatValue(delta.value)}`;
    }
    case 'relationship.retract':
      return `Retract the ${RELATIONSHIP_VERB[delta.relationshipType]} relationship`;
    case 'relationship.restore':
      return `Restore the ${RELATIONSHIP_VERB[delta.relationshipType]} relationship`;
  }
}

/**
 * Exactly the shape the tailoring flow's own "create and link" combination
 * produces: a brand-new element immediately linked to something else, in
 * one commit — nicer as "Add system PowerON and link to Network
 * Operations" than the generic two-delta fallback's "Add system PowerON
 * (2 changes)", which would silently drop the second change's own meaning.
 */
function describeCreateAndLink(first: Delta, second: Delta, nameLookup: NameLookup): string | null {
  if (first.kind !== 'element.create' || second.kind !== 'relationship.create') return null;
  if (second.fromElementId !== first.elementId && second.toElementId !== first.elementId) return null;
  const otherId = second.fromElementId === first.elementId ? second.toElementId : second.fromElementId;
  return `Add ${first.elementType} ${first.name} and link to ${resolveName(nameLookup, otherId)} (2 changes)`;
}

/**
 * The commit title (Sprint U4-1 B1) — every "manual" commit hook computes
 * this and stores it as `CommitEnvelope.title`; whatever text the hook
 * used to hand-write becomes `body` instead (an optional elaboration, not
 * shown anywhere yet, but no longer thrown away). Not used for `merge`/
 * `template_seed`/`genesis` commits — those already have their own
 * well-established, domain-specific phrasing (`mergeRequests.ts`'s
 * "Refresh from main, resolving N conflict(s)", `seedFromMap.ts`'s "Seed
 * from {sector} v{version}", `on_model_created`'s "Genesis") that this
 * function's element/relationship vocabulary has nothing to add to.
 */
export function describeEnvelope(deltas: readonly Delta[], nameLookup: NameLookup): string {
  const first = deltas[0];
  if (!first) return 'No changes';
  if (deltas.length === 1) return describeDelta(first, nameLookup);
  const second = deltas[1];
  if (deltas.length === 2 && second) {
    const combined = describeCreateAndLink(first, second, nameLookup);
    if (combined) return combined;
  }
  return `${describeDelta(first, nameLookup)} (${String(deltas.length)} changes)`;
}

/**
 * Every element a commit's own deltas actually name (Sprint U4-1 B2's
 * "named subjects link to their pages" — ArchitectHome.tsx's activity
 * rows): `elementId` for every `element.*` kind, `fromElementId`/
 * `toElementId` for `relationship.create` — the one relationship kind
 * whose delta carries them at all (`relationship.update`/`retract`/
 * `restore` don't, this module's own top comment explains why, and there's
 * nothing this function can report for those). First-appearance order,
 * de-duplicated — a "link to Y" commit that also creates Y would otherwise
 * list it twice.
 */
export function envelopeSubjects(deltas: readonly Delta[]): UUID[] {
  const seen = new Set<UUID>();
  const ids: UUID[] = [];
  const add = (id: UUID): void => {
    if (seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  };
  for (const delta of deltas) {
    switch (delta.kind) {
      case 'element.create':
      case 'element.update':
      case 'element.retract':
      case 'element.restore':
        add(delta.elementId);
        break;
      case 'relationship.create':
        add(delta.fromElementId);
        add(delta.toElementId);
        break;
      case 'relationship.update':
      case 'relationship.retract':
      case 'relationship.restore':
        break;
    }
  }
  return ids;
}
