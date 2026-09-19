import { Link } from 'react-router';
import type { UUID } from '../../contracts/delta';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import { Chip } from '../components/Chip/Chip';
import { ElementTypeGlyph } from '../components/ElementTypeGlyph/ElementTypeGlyph';
import { Text } from '../components/Text/Text';
import { attributesRecord } from '../elements/attributesRecord';
import { moduleDisplayNameFromMap } from '../elements/moduleDisplayName';
import styles from './IntegrationPlatformMobileList.module.css';

export interface IntegrationPlatformMobileListProps {
  flows: readonly RelationshipsHeadRow[];
  endpoints: ReadonlyMap<UUID, ElementsHeadRow>;
  elementHref: (elementId: UUID) => string;
}

/**
 * Integration platform context's own mobile body (<768px, same "canvas →
 * grouped list" substitution `ContextMobileList.tsx` already makes for the
 * ordinary hub diagram) — grouped by source, the prompt's own wording,
 * rather than by target: a source is the thing initiating each flow, the
 * more natural heading to scan down ("what does A send, and where"). This
 * one list stands in for both the canvas *and* the desktop's separate
 * "flows via this platform" list below it (`PlatformFlowsSection.tsx`) —
 * every flow is already here, just grouped, so mobile never shows the
 * same data twice.
 */
export function IntegrationPlatformMobileList({ flows, endpoints, elementHref }: IntegrationPlatformMobileListProps) {
  const bySource = new Map<UUID, RelationshipsHeadRow[]>();
  for (const flow of flows) {
    const list = bySource.get(flow.from_element_id) ?? [];
    list.push(flow);
    bySource.set(flow.from_element_id, list);
  }
  const sourceIds = [...bySource.keys()].sort((a, b) => {
    const sourceA = endpoints.get(a);
    const sourceB = endpoints.get(b);
    const nameA = sourceA ? moduleDisplayNameFromMap(sourceA, endpoints) : '';
    const nameB = sourceB ? moduleDisplayNameFromMap(sourceB, endpoints) : '';
    return nameA.localeCompare(nameB) || a.localeCompare(b);
  });

  return (
    <div className={styles.list} role="list">
      {sourceIds.map((sourceId) => {
        const source = endpoints.get(sourceId);
        const sourceFlows = [...(bySource.get(sourceId) ?? [])].sort((a, b) => a.relationship_id.localeCompare(b.relationship_id));
        return (
          <div key={sourceId} className={styles.group} role="listitem">
            {source ? (
              <Link to={elementHref(sourceId)} className={styles.groupHeader}>
                <ElementTypeGlyph type={source.element_type} />
                <Text as="span" size="lg">
                  {moduleDisplayNameFromMap(source, endpoints)}
                </Text>
              </Link>
            ) : (
              <Text as="span" size="lg" tone="faint" className={styles.groupHeader}>
                {sourceId}
              </Text>
            )}
            <ul className={styles.rows}>
              {sourceFlows.map((flow) => {
                const target = endpoints.get(flow.to_element_id);
                const description = attributesRecord(flow.attributes).description;
                const dataClassification = attributesRecord(flow.attributes).dataClassification;
                return (
                  <li key={flow.relationship_id} className={styles.row}>
                    {target ? (
                      <Link to={elementHref(flow.to_element_id)} className={styles.rowMain}>
                        <ElementTypeGlyph type={target.element_type} />
                        <Text as="span">{moduleDisplayNameFromMap(target, endpoints)}</Text>
                      </Link>
                    ) : (
                      <Text as="span" tone="faint">
                        {flow.to_element_id}
                      </Text>
                    )}
                    <Chip tone="neutral">{flow.relationship_type.replace('_', ' ')}</Chip>
                    {typeof description === 'string' && description.trim() !== '' && (
                      <Text as="p" tone="muted" size="sm">
                        “{description}”
                      </Text>
                    )}
                    {typeof dataClassification === 'string' && dataClassification.trim() !== '' && (
                      <Text as="p" tone="muted" size="sm">
                        {dataClassification.replace('_', ' ')}
                      </Text>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
