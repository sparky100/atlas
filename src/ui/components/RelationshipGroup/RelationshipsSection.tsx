import { Link } from 'react-router';
import type { RelationshipType, UUID } from '../../../contracts/delta';
import type { FactsRow, RelationshipsHeadRow, ElementsHeadRow } from '../../../contracts/rows';
import type { SourceRow } from '../../../db/types';
import { attributesRecord } from '../../elements/attributesRecord';
import { Chip } from '../Chip/Chip';
import { ElementTypeGlyph } from '../ElementTypeGlyph/ElementTypeGlyph';
import { EmptyState } from '../EmptyState/EmptyState';
import { FactBadge } from '../FactBadge/FactBadge';
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

export interface RelationshipsSectionProps {
  orgSlug: string;
  modelSlug: string;
  elementId: UUID;
  relationships: RelationshipsHeadRow[];
  endpoints: Map<UUID, ElementsHeadRow>;
  relationshipFacts: Map<UUID, Map<string, FactsRow>>;
  sources: Map<UUID, SourceRow>;
}

export function RelationshipsSection({ orgSlug, modelSlug, elementId, relationships, endpoints, relationshipFacts, sources }: RelationshipsSectionProps) {
  if (relationships.length === 0) {
    return <EmptyState>No relationships recorded for this element yet.</EmptyState>;
  }

  return (
    <div>
      {DISPLAY_ORDER.map((type) => {
        const outbound = relationships.filter((r) => r.relationship_type === type && r.from_element_id === elementId);
        const inbound = relationships.filter((r) => r.relationship_type === type && r.to_element_id === elementId);
        if (outbound.length === 0 && inbound.length === 0) return null;

        return (
          <div key={type} className={styles.typeGroup}>
            {outbound.length > 0 && (
              <RelationshipDirectionGroup
                label={DIRECTION_LABEL[type].outbound}
                rows={outbound}
                direction="outbound"
                orgSlug={orgSlug}
                modelSlug={modelSlug}
                endpoints={endpoints}
                relationshipFacts={relationshipFacts}
                sources={sources}
              />
            )}
            {inbound.length > 0 && (
              <RelationshipDirectionGroup
                label={DIRECTION_LABEL[type].inbound}
                rows={inbound}
                direction="inbound"
                orgSlug={orgSlug}
                modelSlug={modelSlug}
                endpoints={endpoints}
                relationshipFacts={relationshipFacts}
                sources={sources}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function RelationshipDirectionGroup({
  label,
  rows,
  direction,
  orgSlug,
  modelSlug,
  endpoints,
  relationshipFacts,
  sources,
}: {
  label: string;
  rows: RelationshipsHeadRow[];
  direction: 'outbound' | 'inbound';
  orgSlug: string;
  modelSlug: string;
  endpoints: Map<UUID, ElementsHeadRow>;
  relationshipFacts: Map<UUID, Map<string, FactsRow>>;
  sources: Map<UUID, SourceRow>;
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
    </div>
  );
}
