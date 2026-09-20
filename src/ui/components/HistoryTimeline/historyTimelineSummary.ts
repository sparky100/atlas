import type { UUID } from '../../../contracts/delta';
import { attributeFieldSchema } from '../../../contracts/attributeSchema';
import { relationshipAttributeFieldSchema } from '../../../contracts/relationshipAttributeSchema';
import type { DeltaHistoryRow } from '../../../db/elements';
import { formatAttributeValue } from '../../elements/formatAttributeValue';
import { INBOUND_VERB, OUTBOUND_VERB } from '../../elements/relationshipVerbs';

export interface HistoryRelationshipParticipants {
  fromElementId: UUID;
  toElementId: UUID;
}

/**
 * A relationship's own endpoints, recovered from its `relationship_create`
 * row — the one relationship-kind delta that carries `from_element_id`/
 * `to_element_id` on itself (`src/contracts/rows.ts`'s `toDeltaRow`;
 * `update`/`retract`/`restore` rows carry neither). That create row is
 * always somewhere in `history`: `listRelationshipHistoryForElement`
 * (`src/db/elements.ts`) finds a relationship by it touching this element
 * at all, then pulls that relationship's *entire* history, its own
 * creation included — so this never needs a second query, only a scan of
 * data already fetched.
 */
export function buildRelationshipParticipantsById(history: readonly DeltaHistoryRow[]): Map<UUID, HistoryRelationshipParticipants> {
  const byId = new Map<UUID, HistoryRelationshipParticipants>();
  for (const delta of history) {
    if (delta.kind === 'relationship_create' && delta.from_element_id && delta.to_element_id) {
      byId.set(delta.subject_id, { fromElementId: delta.from_element_id, toElementId: delta.to_element_id });
    }
  }
  return byId;
}

export interface HistorySummaryContext {
  /** The element whose own page this history is rendered on — which side of a relationship reads as "this element" vs. the other, named side. */
  elementId: UUID;
  participants: ReadonlyMap<UUID, HistoryRelationshipParticipants>;
  /** Current names for every element named by a `participants` entry — `useElementPage.ts`'s own `relationshipEndpoints`, widened to cover a since-retracted relationship's endpoints too, not just today's live ones. An id missing here (its own element has itself since been retracted) falls back to the raw id, same convention `VersionDiffView.tsx`'s `RelationshipDiffRow` already uses. */
  elementNamesById: ReadonlyMap<UUID, string>;
}

/** `outbound`/`inbound` verb phrase (`relationshipVerbs.ts`) plus the other element's own name — "supports Smart Metering Data" / "supported by Enterprise Resource Planning" — or just the bare verb when the relationship's own endpoints can't be found (defensive only; see `buildRelationshipParticipantsById`'s own comment on why they normally always can be). */
function relationshipVerbPhrase(subjectId: UUID, relationshipType: DeltaHistoryRow['relationship_type'], ctx: HistorySummaryContext): string {
  const pair = ctx.participants.get(subjectId);
  const outbound = !pair || pair.fromElementId === ctx.elementId;
  const verb = relationshipType ? (outbound ? OUTBOUND_VERB[relationshipType] : INBOUND_VERB[relationshipType]) : 'relationship';
  if (!pair) return verb;
  const otherId = pair.fromElementId === ctx.elementId ? pair.toElementId : pair.fromElementId;
  const otherName = ctx.elementNamesById.get(otherId) ?? otherId;
  return `${verb} ${otherName}`;
}

/** One `HistoryTimeline.tsx` entry's own display text — specific enough to tell two "created (supports)" rows apart by which capability/system each one actually names, not just the relationship type they share. */
export function summariseHistoryEntry(delta: DeltaHistoryRow, ctx: HistorySummaryContext): string {
  switch (delta.kind) {
    case 'element_create':
      return `created — ${delta.name ?? ''}`;
    case 'element_update':
    case 'element_update_custom': {
      const label = (delta.element_type && attributeFieldSchema(delta.element_type, delta.attribute)?.label) ?? delta.attribute;
      return `${label}: ${formatAttributeValue(delta.value)}`;
    }
    case 'element_retract':
      return 'retracted';
    case 'element_restore':
      return 'restored';
    case 'relationship_create':
      return `created — ${relationshipVerbPhrase(delta.subject_id, delta.relationship_type, ctx)}`;
    case 'relationship_retract':
      return `retracted — ${relationshipVerbPhrase(delta.subject_id, delta.relationship_type, ctx)}`;
    case 'relationship_restore':
      return `restored — ${relationshipVerbPhrase(delta.subject_id, delta.relationship_type, ctx)}`;
    case 'relationship_update':
    case 'relationship_update_custom': {
      const label = (delta.relationship_type && relationshipAttributeFieldSchema(delta.relationship_type, delta.attribute)?.label) ?? delta.attribute;
      return `${label}: ${formatAttributeValue(delta.value)} — ${relationshipVerbPhrase(delta.subject_id, delta.relationship_type, ctx)}`;
    }
  }
}
