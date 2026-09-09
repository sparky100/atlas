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

/** Everything `RelationshipAdd` needs beyond the group slot itself and direction — one object so `RelationshipsSection`'s own prop list doesn't grow one entry per field every time the create path needs another. Omitted entirely (not passed disabled) when the caller hasn't established edit rights, same convention as `CapabilityMapView`'s `addCapability`. */
export interface RelationshipsSectionAddConfig {
  modelId: UUID;
  orgId: UUID;
  userId: UUID | null;
  /** This element's own name — only for the generated commit title (`useRelationshipCreate`'s own doc comment). */
  elementName: string;
  searchCommitId: UUID;
  branch: BranchRow;
  expectedHeadCommitId: UUID;
  onCreated: () => void;
}

export interface RelationshipsSectionProps {
  orgSlug: string;
  modelSlug: string;
  elementId: UUID;
  elementType: ElementType;
  relationships: RelationshipsHeadRow[];
  endpoints: Map<UUID, ElementsHeadRow>;
  relationshipFacts: Map<UUID, Map<string, FactsRow>>;
  sources: Map<UUID, SourceRow>;
  addRelationship?: RelationshipsSectionAddConfig | undefined;
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
export function RelationshipsSection({ orgSlug, modelSlug, elementId, elementType, relationships, endpoints, relationshipFacts, sources, addRelationship }: RelationshipsSectionProps) {
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
              orgSlug={orgSlug}
              modelSlug={modelSlug}
              endpoints={endpoints}
              relationshipFacts={relationshipFacts}
              sources={sources}
              addRelationship={addRelationship}
            />
          )}
          {showInbound && (
            <RelationshipDirectionGroup
              label={DIRECTION_LABEL[type].inbound}
              rows={inboundRows}
              direction="inbound"
              slot={inboundSlot}
              elementId={elementId}
              orgSlug={orgSlug}
              modelSlug={modelSlug}
              endpoints={endpoints}
              relationshipFacts={relationshipFacts}
              sources={sources}
              addRelationship={addRelationship}
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
  orgSlug,
  modelSlug,
  endpoints,
  relationshipFacts,
  sources,
  addRelationship,
}: {
  label: string;
  rows: RelationshipsHeadRow[];
  direction: 'outbound' | 'inbound';
  slot: RelationshipGroupSlot | undefined;
  elementId: UUID;
  orgSlug: string;
  modelSlug: string;
  endpoints: Map<UUID, ElementsHeadRow>;
  relationshipFacts: Map<UUID, Map<string, FactsRow>>;
  sources: Map<UUID, SourceRow>;
  addRelationship?: RelationshipsSectionAddConfig | undefined;
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
        const isPrimaryOwner = rel.relationship_type === 'owns' && attrs.primary === true;

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
            {isPrimaryOwner && (
              <span aria-label="primary owner" title="Primary owner">
                ★
              </span>
            )}
            {typeof dataClassification === 'string' && dataClassification.length > 0 && <Chip tone="info">{dataClassification}</Chip>}
            {existsFact && <FactBadge fact={existsFact} source={sources.get(existsFact.source_id)} />}
          </div>
        );
      })}
      {addRelationship && slot && (
        <RelationshipAdd
          slot={slot}
          direction={direction}
          elementId={elementId}
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
