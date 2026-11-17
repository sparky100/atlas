import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { UUID } from '../../contracts/delta';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import { Chip } from '../components/Chip/Chip';
import { Text } from '../components/Text/Text';
import { fitForPurposeToneFor } from '../elements/fitForPurposeTone';
import { buildSupportMatrix, cellKey } from './supportMatrix';
import styles from './SupportMatrix.module.css';

export interface SupportMatrixProps {
  /** The systems and modules the Landscape's filters leave in. */
  systems: readonly ElementsHeadRow[];
  supportsEdges: readonly RelationshipsHeadRow[];
  capabilitiesById: ReadonlyMap<UUID, ElementsHeadRow>;
  focusedElementId: UUID | null;
  onFocusElement: (elementId: UUID) => void;
  capabilityHref: (capabilityId: UUID) => string;
  elementHref: (elementId: UUID) => string;
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Who supports what: a grid of systems (rows) against level 1 capabilities
 * (columns), each cell naming the fit. A view over the Landscape's own rows,
 * so it follows the same filters and "View as at" date. It scrolls inside its
 * own frame, with the header row and the system names held in place.
 */
export function SupportMatrix({ systems, supportsEdges, capabilitiesById, focusedElementId, onFocusElement, capabilityHref, elementHref }: SupportMatrixProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<UUID>>(new Set());
  const matrix = useMemo(() => buildSupportMatrix({ systems, supportsEdges, capabilitiesById, expandedL1Ids: expanded }), [systems, supportsEdges, capabilitiesById, expanded]);

  function toggle(l1Id: UUID): void {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(l1Id)) next.delete(l1Id);
      else next.add(l1Id);
      return next;
    });
  }

  if (matrix.columns.length === 0) return <Text as="p" tone="muted">No capabilities yet, so there is nothing to lay the systems against.</Text>;

  return (
    <div className={styles.frame} role="region" aria-label="Systems by capability">
      <table className={styles.table}>
        <caption className={styles.caption}>
          <Text as="span" tone="muted" size="sm">
            Each cell is the fit of a system for a capability. A closed capability counts everything beneath it.
          </Text>
        </caption>
        <thead>
          <tr>
            <th scope="col" className={styles.corner}>
              System
            </th>
            {matrix.columns.map((column) => (
              <th key={column.key} scope="col" className={column.level === 2 ? styles.childHead : styles.head}>
                <Link to={capabilityHref(column.capabilityId)}>{column.label}</Link>
                {column.level === 1 && column.expandable && (
                  <button
                    type="button"
                    className={styles.expand}
                    aria-expanded={column.expanded}
                    aria-label={`${column.expanded ? 'Close' : 'Open'} ${capabilitiesById.get(column.capabilityId)?.name ?? 'capability'}`}
                    onClick={() => {
                      toggle(column.l1Id);
                    }}
                  >
                    {column.expanded ? '−' : '+'}
                  </button>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.rows.map((row) => {
            const id = row.system.element_id;
            return (
              <tr key={id} className={focusedElementId === id ? styles.focusedRow : undefined}>
                <th scope="row" className={row.depth === 1 ? styles.moduleName : styles.systemName}>
                  <Link to={elementHref(id)}>{row.system.name}</Link>
                </th>
                {matrix.columns.map((column) => {
                  const cell = matrix.cells.get(cellKey(id, column.key));
                  if (!cell) return <td key={column.key} className={styles.empty} />;
                  const fitText = cell.fit ? capitalise(cell.fit) : 'Not rated';
                  const links = cell.edges.length;
                  return (
                    <td key={column.key} className={styles.cell}>
                      <button
                        type="button"
                        className={styles.cellButton}
                        aria-label={`${row.system.name} supports ${column.label}: ${fitText}${cell.primary ? ', primary' : ''}${links > 1 ? `, ${String(links)} links` : ''}`}
                        onClick={() => {
                          onFocusElement(id);
                        }}
                      >
                        <Chip tone={cell.fit ? fitForPurposeToneFor(cell.fit) : 'neutral'}>{fitText}</Chip>
                        {cell.primary && (
                          <Text as="span" tone="muted" size="sm">
                            primary
                          </Text>
                        )}
                        {links > 1 && (
                          <Text as="span" tone="muted" size="sm">
                            {links} links
                          </Text>
                        )}
                      </button>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      {matrix.rows.length === 0 && <Text as="p" tone="muted">No systems match the filters.</Text>}
      {matrix.unplacedLinks > 0 && (
        <Text as="p" tone="muted" size="sm">
          {matrix.unplacedLinks} {matrix.unplacedLinks === 1 ? 'link goes' : 'links go'} to a capability that is not in the capability tree, so {matrix.unplacedLinks === 1 ? 'it is' : 'they are'} not shown.
        </Text>
      )}
    </div>
  );
}
