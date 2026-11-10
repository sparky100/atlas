import { Link } from 'react-router';
import type { UUID } from '../../contracts/delta';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import { Text } from '../components/Text/Text';
import type { CapabilityMapTree } from './layout';
import type { ColourByMode } from './metrics';
import { buildWholeMap } from './wholeMap';
import styles from './CapabilityWholeMapView.module.css';

export interface CapabilityWholeMapViewProps {
  tree: CapabilityMapTree;
  colourBy: ColourByMode;
  supportsEdges: readonly RelationshipsHeadRow[];
  systemsById: ReadonlyMap<UUID, ElementsHeadRow>;
  replacedIds: ReadonlySet<UUID>;
  orgSlug: string;
  modelSlug: string;
}

/**
 * The whole capability map on one screen (BIZBOK's "one-page map"): every
 * top-level area as a column, its capabilities as small tiles. A tile is tinted
 * only when the chosen measure is a problem for it, in the colours that mean
 * the same thing everywhere else, with the reason written beside the tint. Every
 * tile links to the capability, which is where the problem is dealt with.
 * Still a query over the model plus a layout — nothing here stores positions.
 */
export function CapabilityWholeMapView({ tree, colourBy, supportsEdges, systemsById, replacedIds, orgSlug, modelSlug }: CapabilityWholeMapViewProps) {
  const map = buildWholeMap(tree, colourBy, supportsEdges, systemsById, replacedIds);
  const href = (id: UUID): string => `/o/${orgSlug}/m/${modelSlug}/e/${id}`;
  return (
    <div className={styles.wrapper}>
      <div className={styles.summary} aria-live="polite">
        {colourBy === 'none' ? (
          <Text as="p" size="sm" tone="muted">
            Nothing is coloured. Choose what to colour by under Filters.
          </Text>
        ) : map.problemCount === 0 ? (
          <Text as="p" size="sm" tone="muted">
            No capability is flagged for the chosen colouring.
          </Text>
        ) : (
          <ul className={styles.legend} aria-label="Colour key">
            {map.legend.map((item) => (
              <li key={item.label} className={styles.legendItem}>
                <span className={styles.swatch} data-tone={item.tone} aria-hidden="true" />
                <Text as="span" size="sm">
                  {item.label}
                </Text>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className={styles.grid} role="list" aria-label="Capability areas">
        {map.columns.map((column) => (
          <section key={column.domain.element_id} className={styles.column} role="listitem">
            <Link to={href(column.domain.element_id)} className={styles.domainLink} data-tone={column.tone ?? 'none'}>
              <Text as="span" size="md" className={styles.domainName}>
                {column.domain.name}
              </Text>
              {column.label !== undefined && (
                <Text as="span" size="xs" tone="muted">
                  {column.label}
                </Text>
              )}
            </Link>
            <ul className={styles.tiles}>
              {column.tiles.map((tile) => (
                <li key={tile.capability.element_id}>
                  <Link to={href(tile.capability.element_id)} className={styles.tile} data-tone={tile.tone ?? 'none'}>
                    <Text as="span" size="sm" className={styles.tileName}>
                      {tile.capability.name}
                    </Text>
                    {tile.label !== undefined && (
                      <Text as="span" size="xs" tone="muted">
                        {tile.label}
                      </Text>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
