import { Link } from 'react-router';
import { Chip } from '../components/Chip/Chip';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { Text } from '../components/Text/Text';
import type { ExposureTone } from '../../db/modelHome';
import type { CapabilityMapTree } from '../capabilityMap/layout';
import styles from './CapabilityMapThumbnail.module.css';

export interface CapabilityMapThumbnailProps {
  tree: CapabilityMapTree;
  exposureTone: ExposureTone;
  capabilityMapHref: string;
}

/**
 * The director door's capability-map preview (UI-principles §3.1) — a
 * compact grid of level-1 tile names linking through to the real
 * `CapabilityMapView`, not a second rendering of its full tile layout
 * (level-2 cards, colour-by, zoom-to-level-3). `exposureTone` is the one
 * overall signal this sprint builds (src/db/modelHome.ts's own module
 * comment: a coarser stand-in for §3.1's full per-tile health chips).
 */
export function CapabilityMapThumbnail({ tree, exposureTone, capabilityMapHref }: CapabilityMapThumbnailProps) {
  if (tree.l1.length === 0) {
    return (
      <div>
        <EmptyState>No capabilities yet.</EmptyState>
        <Link to={capabilityMapHref}>
          <Text as="span">Start the capability map →</Text>
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className={styles.header}>
        {exposureTone === 'warn' && <Chip tone="warn">lifecycle exposure</Chip>}
        {exposureTone === 'ok' && <Chip tone="ok">no known exposure</Chip>}
      </div>
      <Link to={capabilityMapHref} className={styles.grid}>
        {tree.l1.map((column) => (
          <span key={column.capability.element_id} className={styles.tile}>
            <Text as="span" size="sm">
              {column.capability.name}
            </Text>
          </span>
        ))}
      </Link>
    </div>
  );
}
