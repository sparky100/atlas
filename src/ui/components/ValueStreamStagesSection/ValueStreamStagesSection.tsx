import { Link } from 'react-router';
import type { ElementsHeadRow } from '../../../contracts/rows';
import { EmptyState } from '../EmptyState/EmptyState';
import { ElementTypeGlyph } from '../ElementTypeGlyph/ElementTypeGlyph';
import { Text } from '../Text/Text';
import { compareBySiblingOrder } from '../../elements/siblingOrder';
import styles from './ValueStreamStagesSection.module.css';

export interface ValueStreamStagesSectionProps {
  orgSlug: string;
  modelSlug: string;
  /** The stream's own children (`ElementPageData.children`) — this section is stream-only, so every one of these is already a stage. */
  stages: readonly ElementsHeadRow[];
}

/**
 * A value stream's own "Stages" section (F6/ADR-023): `StructureSection.tsx`'s
 * own "Children" shape, but ordered by `order` (`compareBySiblingOrder` —
 * the same comparator the Value streams page's own stage tiles use) rather
 * than the generic section's name order, since "stages left to right" is
 * meaningful sequence here, not an alphabetical accident.
 */
export function ValueStreamStagesSection({ orgSlug, modelSlug, stages }: ValueStreamStagesSectionProps) {
  if (stages.length === 0) return <EmptyState>No stages recorded yet.</EmptyState>;

  const ordered = [...stages].sort(compareBySiblingOrder);
  return (
    <ul className={styles.list}>
      {ordered.map((stage) => (
        <li key={stage.element_id}>
          <Link to={`/o/${orgSlug}/m/${modelSlug}/e/${stage.element_id}`} className={styles.link}>
            <ElementTypeGlyph type={stage.element_type} />
            <Text as="span">{stage.name}</Text>
          </Link>
        </li>
      ))}
    </ul>
  );
}
