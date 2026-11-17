import { useId, useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { UUID } from '../../contracts/delta';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import { Text } from '../components/Text/Text';
import { buildIntegrationRows } from '../integrations/integrationRows';
import { buildConnectionsMatrix, connectionCellKey, type ConnectionKind } from './connectionsMatrixModel';
import type { LandscapeGroup } from './landscapeGroups';
import styles from './ConnectionsMatrix.module.css';

export interface ConnectionsMatrixProps {
  groups: readonly LandscapeGroup[];
  internalActorIds: readonly UUID[];
  edges: readonly RelationshipsHeadRow[];
  /** Every system, module and actor on the view, for naming each link's two ends. */
  elementsById: ReadonlyMap<UUID, ElementsHeadRow>;
  elementHref: (elementId: UUID) => string;
  /** The full Integrations list, for platforms, interfaces and everything else a link carries. */
  integrationsHref: string;
}

const KIND_WORDS: Record<ConnectionKind, { toggle: string; sentence: (from: string, to: string) => string; intro: string }> = {
  flows_to: { toggle: 'Data flows', sentence: (from, to) => `${from} sends data to ${to}`, intro: 'Each cell counts the data flows from the area on the left to the area across the top: "A sends data to B".' },
  uses: { toggle: 'Dependencies', sentence: (from, to) => `${from} relies on ${to}`, intro: 'Each cell counts the dependencies from the area on the left to the area across the top: "A relies on B".' },
};

/**
 * Which areas of the business send data to, or rely on, which others — counted,
 * so it stays readable on a model where a line for every link would not be.
 * A fixed grid in the Landscape's lane order; click a cell to list its links.
 */
export function ConnectionsMatrix({ groups, internalActorIds, edges, elementsById, elementHref, integrationsHref }: ConnectionsMatrixProps) {
  const [kind, setKind] = useState<ConnectionKind>('flows_to');
  const [selected, setSelected] = useState<{ from: string; to: string } | null>(null);
  const detailId = useId();
  const matrix = useMemo(() => buildConnectionsMatrix(groups, internalActorIds, edges, kind), [groups, internalActorIds, edges, kind]);
  const labelOf = (key: string): string => matrix.areas.find((a) => a.key === key)?.label ?? key;
  const rows = useMemo(() => {
    const selectedEdges = selected ? (matrix.cells.get(connectionCellKey(selected.from, selected.to)) ?? []) : [];
    return buildIntegrationRows(selectedEdges, elementsById);
  }, [selected, matrix, elementsById]);
  const words = KIND_WORDS[kind];
  const total = [...matrix.cells.values()].reduce((n, list) => n + list.length, 0);

  return (
    <div className={styles.frame}>
      <div className={styles.toolbar} role="group" aria-label="Kind of connection">
        {(Object.keys(KIND_WORDS) as ConnectionKind[]).map((k) => (
          <button
            key={k}
            type="button"
            className={styles.kindButton}
            aria-pressed={kind === k}
            onClick={() => {
              setKind(k);
              setSelected(null);
            }}
          >
            {KIND_WORDS[k].toggle}
          </button>
        ))}
        <Text as="span" tone="muted" size="sm">
          {total} {kind === 'flows_to' ? (total === 1 ? 'data flow' : 'data flows') : total === 1 ? 'dependency' : 'dependencies'}
        </Text>
      </div>
      <Text as="p" tone="muted" size="sm">
        {words.intro} The diagonal is links inside one area.
      </Text>
      {matrix.areas.length === 0 ? (
        <Text as="p" tone="muted">
          No systems to group yet.
        </Text>
      ) : (
        <div className={styles.scroll} role="region" aria-label="Connections between areas">
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col" className={styles.corner}>
                  From ↓ / To →
                </th>
                {matrix.areas.map((area) => (
                  <th key={area.key} scope="col" className={styles.head}>
                    {area.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.areas.map((from) => (
                <tr key={from.key}>
                  <th scope="row" className={styles.rowHead}>
                    {from.label}
                  </th>
                  {matrix.areas.map((to) => {
                    const count = matrix.cells.get(connectionCellKey(from.key, to.key))?.length ?? 0;
                    const isSelected = selected?.from === from.key && selected.to === to.key;
                    return (
                      <td key={to.key} className={[styles.cell, from.key === to.key ? styles.diagonal : ''].filter(Boolean).join(' ')}>
                        {count === 0 ? (
                          <span className={styles.none} aria-label={`${words.sentence(from.label, to.label)}: none`}>
                            ·
                          </span>
                        ) : (
                          <button
                            type="button"
                            className={styles.count}
                            aria-pressed={isSelected}
                            aria-controls={detailId}
                            aria-label={`${words.sentence(from.label, to.label)}: ${String(count)}`}
                            onClick={() => {
                              setSelected(isSelected ? null : { from: from.key, to: to.key });
                            }}
                          >
                            {count}
                          </button>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {matrix.unplaced > 0 && (
        <Text as="p" tone="muted" size="sm">
          {matrix.unplaced} {matrix.unplaced === 1 ? 'link is' : 'links are'} not counted because one end is hidden by the filters.
        </Text>
      )}
      <div id={detailId} className={styles.detail} aria-live="polite">
        {selected && (
          <>
            <Text as="h2" size="lg">
              {words.sentence(labelOf(selected.from), labelOf(selected.to))}
            </Text>
            <ul className={styles.list}>
              {rows.map((row) => (
                <li key={row.relationshipId} className={styles.item}>
                  <Link to={elementHref(row.source.element_id)}>{row.sourceName}</Link>
                  <span aria-hidden="true"> → </span>
                  <span className={styles.visuallyHidden}>{kind === 'flows_to' ? ' sends data to ' : ' relies on '}</span>
                  <Link to={elementHref(row.target.element_id)}>{row.targetName}</Link>
                  <Text as="span" tone="muted" size="sm">
                    {[row.platform ? `via ${row.platform.name}` : null, row.protocol, row.dataClassification].filter(Boolean).join(' · ')}
                  </Text>
                </li>
              ))}
            </ul>
            <Link to={integrationsHref}>Open the Integrations list →</Link>
          </>
        )}
      </div>
    </div>
  );
}
