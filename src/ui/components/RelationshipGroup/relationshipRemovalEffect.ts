/**
 * "Relationship removal": the confirmation panel's own effect sentence and
 * the primary-`supports`-specific "make `<other>` primary" candidate list —
 * pulled out of `RelationshipRemove.tsx` so both are unit-testable without
 * mounting a component.
 *
 * `EFFECT_VERB` is deliberately distinct from `RelationshipsSection.tsx`'s
 * own `DIRECTION_LABEL` (used for that file's row-group headings, e.g.
 * "supports (3)"): those forms read wrong after "will no longer" (`"X will
 * no longer supports Y"` is bad grammar) — the outbound side here is the
 * bare infinitive, matching the prompt's own worked example verbatim:
 * "ArcGIS will no longer support Asset Management."
 */
import type { RelationshipType } from '../../../contracts/delta';
import type { RelationshipsHeadRow } from '../../../contracts/rows';
import { attributesRecord } from '../../elements/attributesRecord';

export type RelationshipDirection = 'outbound' | 'inbound';

const EFFECT_VERB: Record<RelationshipType, { outbound: string; inbound: string }> = {
  supports: { outbound: 'support', inbound: 'be supported by' },
  owns: { outbound: 'own', inbound: 'be owned by' },
  uses: { outbound: 'use', inbound: 'be used by' },
  flows_to: { outbound: 'flow to', inbound: 'receive from' },
};

/** `"{elementName} will no longer {verb} {otherName}."` — always shown, regardless of relationship type or direction. */
export function relationshipRemovalEffectSentence(relationshipType: RelationshipType, direction: RelationshipDirection, elementName: string, otherName: string): string {
  return `${elementName} will no longer ${EFFECT_VERB[relationshipType][direction]} ${otherName}.`;
}

/**
 * True only for the one case that gets the "make `<other>` primary"
 * affordance at all: an outbound `supports` row currently holding
 * `role: 'primary'`. Never true for the inbound ("supported by") side of
 * the same relationship type — "primary" decides which lane the *anchor
 * system's own* tile lands in, a per-system concept with no natural
 * "other" candidate from a capability's own page.
 */
export function isPrimaryOutboundSupportsRow(relationshipType: RelationshipType, direction: RelationshipDirection, relationship: RelationshipsHeadRow): boolean {
  return relationshipType === 'supports' && direction === 'outbound' && attributesRecord(relationship.attributes).role === 'primary';
}

/**
 * Every other live outbound `supports` row from the same anchor — the
 * "make `<other>` primary" candidates. `siblingRows` is the same
 * type/direction group's own already-computed row list
 * (`RelationshipsSection.tsx`'s `outboundRows`), so this does no querying
 * of its own; an empty result means the row being removed is the anchor's
 * only supports edge, which `placementFor` (`src/ui/landscape/layout.ts`)
 * unconditionally resolves to the Unassigned lane.
 */
export function otherPrimaryCandidates(removedRelationshipId: string, siblingRows: readonly RelationshipsHeadRow[]): RelationshipsHeadRow[] {
  return siblingRows.filter((row) => row.relationship_id !== removedRelationshipId);
}
