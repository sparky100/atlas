import { Link } from 'react-router';
import type { ElementType, RelationshipType, UUID } from '../../../contracts/delta';
import type { FactsRow, RelationshipsHeadRow, ElementsHeadRow } from '../../../contracts/rows';
import { inboundRelationshipGroups, outboundRelationshipGroups, type RelationshipGroupSlot } from '../../../contracts/relationshipTypeRules';
import type { BranchRow, SourceRow } from '../../../db/types';
import { attributesRecord } from '../../elements/attributesRecord';
import { Chip } from '../Chip/Chip';
import { ElementTypeGlyph } from '../ElementTypeGlyph/ElementTypeGlyph';
import { EmptyState } from '../EmptyState/EmptyState';
import { FactBadge } from '../FactBadge/FactBadge';
import { RelationshipAdd } from './RelationshipAdd';
import { RelationshipRemove, type RelationshipsSectionRemoveConfig } from './RelationshipRemove';
import { Text } from '../Text/Text';
import styles from './RelationshipsSection.module.css';

// Fixed display order (UI-principles §4.4) — distinct from RELATIONSHIP_TYPES'
// wire-contract listing order, which doesn't itself mandate a UI order.
const DISPLAY_ORDER: RelationshipType[] = ['supports', 'owns', 'uses', 'flows_to'];

const DIRECTION_LABEL: Record<RelationshipType, { outbound: string; inbound: string }> = {
  supports: { outbound: 'supports', inbound: 'supported by' },
  owns: { outbound: 'owns', inbound: 'owned by' },
  uses: { outbound: 'uses', inbound: 'used by' },
  flows_to: { outbound: 'flows to', inbound: 'receives from' },
};

/** Everything `RelationshipAdd` needs beyond the group slot itself and direction — one object so `RelationshipsSection`'s own prop list doesn't grow one entry per field every time the create path needs another. Omitted entirely (not passed disabled) when the caller hasn't established edit rights, same convention as `CapabilityMapView`'s `reorderCapability`. */
export interface RelationshipsSectionAddConfig {
  modelId: UUID;
  orgId: UUID;
  userId: UUID | null;
  /** This element's own name — only for the generated commit title (`useRelationshipCreate`'s own doc comment). */
  elementName: string;
  searchCommitId: UUID;
  branch: BranchRow;
  expectedHeadCommitId: UUID;
  /** The newly related element's id — the caller (ElementPage.tsx) uses this to mark the row "just added" (Handoff — Flow: Add a system, step 7). */
  onCreated: (otherElementId: UUID) => void;
}

export interface RelationshipsSectionProps {
  orgSlug: string;
  modelSlug: string;
  elementId: UUID;
  elementType: ElementType;
  /** This element's own current name — "Relationship removal"'s confirmation sentence subject (`elementName` on `addRelationship` already carries this for the create side; the remove side needs it unconditionally, even when `removeRelationship` is the only config given). */
  elementName: string;
  relationships: RelationshipsHeadRow[];
  endpoints: Map<UUID, ElementsHeadRow>;
  relationshipFacts: Map<UUID, Map<string, FactsRow>>;
  sources: Map<UUID, SourceRow>;
  addRelationship?: RelationshipsSectionAddConfig | undefined;
  /** "Relationship removal": each row's own "⋯ Remove" — omitted entirely (not shown disabled) when the caller hasn't established edit rights, same convention as `addRelationship`. */
  removeRelationship?: RelationshipsSectionRemoveConfig | undefined;
  /** The other element id of a relationship just added in this session (Handoff — Flow: Add a system, step 7's `just added` chip) — cleared by the caller once acknowledged, not by this component. */
  justAddedElementId?: UUID | null;
}

/**
 * Blocking: element creation generalised this from a pure read-only list to
 * also enumerate every relationship-type/direction slot `elementType` can
 * legally have (`RELATIONSHIP_TYPE_RULES`, via `outboundRelationshipGroups`/
 * `inboundRelationshipGroups`) — not just the ones with existing rows — so
 * a slot with nothing in it yet still gets its own "+ Add" (per the user's
 * own clarification on where relationship creation lives: "A '+ Add' under
 * each relationship-type group the element is allowed to have"). A slot
 * with neither existing rows nor (when `addRelationship` is given) the
 * right to add is skipped entirely, same as before this generalisation.
 */
export function RelationshipsSection({ orgSlug, modelSlug, elementId, elementType, elementName, relationships, endpoints, relationshipFacts, sources, addRelationship, removeRelationship, justAddedElementId = null }: RelationshipsSectionProps) {
  const outboundSlots = new Map(outboundRelationshipGroups(elementType).map((slot) => [slot.relationshipType, slot]));
  const inboundSlots = new Map(inboundRelationshipGroups(elementType).map((slot) => [slot.relationshipType, slot]));

  const groups = DISPLAY_ORDER.map((type) => {
    const outboundRows = relationships.filter((r) => r.relationship_type === type && r.from_element_id === elementId);
    const inboundRows = relationships.filter((r) => r.relationship_type === type && r.to_element_id === elementId);
    const outboundSlot = outboundSlots.get(type);
    const inboundSlot = inboundSlots.get(type);
    const showOutbound = outboundRows.length > 0 || (addRelationship !== undefined && outboundSlot !== undefined);
    const showInbound = inboundRows.length > 0 || (addRelationship !== undefined && inboundSlot !== undefined);
    return { type, outboundRows, inboundRows, outboundSlot, inboundSlot, showOutbound, showInbound };
  }).filter((group) => group.showOutbound || group.showInbound);

  if (groups.length === 0) {
    return <EmptyState>No relationships recorded for this element yet.</EmptyState>;
  }

  return (
    <div>
      {groups.map(({ type, outboundRows, inboundRows, outboundSlot, inboundSlot, showOutbound, showInbound }) => (
        <div key={type} className={styles.typeGroup}>
          {showOutbound && (
            <RelationshipDirectionGroup
              label={DIRECTION_LABEL[type].outbound}
              rows={outboundRows}
              direction="outbound"
              slot={outboundSlot}
              elementId={elementId}
              elementType={elementType}
              elementName={elementName}
              orgSlug={orgSlug}
              modelSlug={modelSlug}
              endpoints={endpoints}
              relationshipFacts={relationshipFacts}
              sources={sources}
              addRelationship={addRelationship}
              removeRelationship={removeRelationship}
              justAddedElementId={justAddedElementId}
            />
          )}
          {showInbound && (
            <RelationshipDirectionGroup
              label={DIRECTION_LABEL[type].inbound}
              rows={inboundRows}
              direction="inbound"
              slot={inboundSlot}
              elementId={elementId}
              elementType={elementType}
              elementName={elementName}
              orgSlug={orgSlug}
              modelSlug={modelSlug}
              endpoints={endpoints}
              relationshipFacts={relationshipFacts}
              sources={sources}
              addRelationship={addRelationship}
              removeRelationship={removeRelationship}
              justAddedElementId={justAddedElementId}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function RelationshipDirectionGroup({
  label,
  rows,
  direction,
  slot,
  elementId,
  elementType,
  elementName,
  orgSlug,
  modelSlug,
  endpoints,
  relationshipFacts,
  sources,
  addRelationship,
  removeRelationship,
  justAddedElementId,
}: {
  label: string;
  rows: RelationshipsHeadRow[];
  direction: 'outbound' | 'inbound';
  slot: RelationshipGroupSlot | undefined;
  elementId: UUID;
  elementType: ElementType;
  elementName: string;
  orgSlug: string;
  modelSlug: string;
  endpoints: Map<UUID, ElementsHeadRow>;
  relationshipFacts: Map<UUID, Map<string, FactsRow>>;
  sources: Map<UUID, SourceRow>;
  addRelationship?: RelationshipsSectionAddConfig | undefined;
  removeRelationship?: RelationshipsSectionRemoveConfig | undefined;
  justAddedElementId?: UUID | null;
}) {
  return (
    <div className={styles.directionGroup}>
      <Text as="h3" size="md" className={styles.groupLabel}>
        {label} <Text as="span" tone="muted">({rows.length})</Text>
      </Text>
      {rows.map((rel) => {
        const otherId = direction === 'outbound' ? rel.to_element_id : rel.from_element_id;
        const other = endpoints.get(otherId);
        const facts = relationshipFacts.get(rel.relationship_id);
        const existsFact = facts?.get('$exists');
        const attrs = attributesRecord(rel.attributes);
        const dataClassification = attrs.dataClassification;
        // Prompt 7k item 2: owns.role replaces owns.primary — the row shows
        // which role this owns edge asserts (a target can have up to three
        // owners at once, one per role), not a single ★ "the owner" marker.
        const ownsRole = rel.relationship_type === 'owns' && typeof attrs.role === 'string' ? attrs.role : null;
        // The verb-phrase label (Sprint U4-1 B5: required at creation for
        // uses/flows_to, optional elsewhere) — shown whenever one exists,
        // not gated to those two types, since `description` is the same
        // free-text attribute on every relationship type and nothing else
        // in this row surfaces it otherwise.
        const description = attrs.description;
        const justAdded = other !== undefined && other.element_id === justAddedElementId;

        return (
          <div key={rel.relationship_id} className={styles.row}>
            <span className={styles.arrow} aria-hidden="true">
              {direction === 'outbound' ? '→' : '←'}
            </span>
            {other ? (
              <Link to={`/o/${orgSlug}/m/${modelSlug}/e/${other.element_id}`} className={styles.endpointLink}>
                <ElementTypeGlyph type={other.element_type} />
                <Text as="span">{other.name}</Text>
              </Link>
            ) : (
              <Text as="span" tone="faint">
                (unknown element)
              </Text>
            )}
            <Text tone="muted" size="sm" as="span">
              {other?.element_type ?? ''}
            </Text>
            {typeof description === 'string' && description.trim().length > 0 && (
              <Text tone="muted" size="sm" as="span">
                “{description}”
              </Text>
            )}
            {ownsRole !== null && <Chip tone="neutral">{ownsRole} owner</Chip>}
            {typeof dataClassification === 'string' && dataClassification.length > 0 && <Chip tone="info">{dataClassification}</Chip>}
            {justAdded && <Chip tone="info">just added</Chip>}
            {existsFact && <FactBadge fact={existsFact} source={sources.get(existsFact.source_id)} />}
            {removeRelationship && (
              <RelationshipRemove
                relationship={rel}
                direction={direction}
                elementName={elementName}
                otherName={other?.name}
                siblingRows={rows}
                endpoints={endpoints}
                relationshipFacts={relationshipFacts}
                config={removeRelationship}
              />
            )}
          </div>
        );
      })}
      {addRelationship && slot && (
        <RelationshipAdd
          slot={slot}
          direction={direction}
          elementId={elementId}
          elementType={elementType}
          elementName={addRelationship.elementName}
          existingRows={rows}
          relationshipFacts={relationshipFacts}
          modelId={addRelationship.modelId}
          orgId={addRelationship.orgId}
          userId={addRelationship.userId}
          searchCommitId={addRelationship.searchCommitId}
          branch={addRelationship.branch}
          expectedHeadCommitId={addRelationship.expectedHeadCommitId}
          onCreated={addRelationship.onCreated}
        />
      )}
    </div>
  );
}
