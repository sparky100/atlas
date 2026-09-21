import { Link } from 'react-router';
import type { ElementsHeadRow } from '../../../contracts/rows';
import { EmptyState } from '../EmptyState/EmptyState';
import { ElementTypeGlyph } from '../ElementTypeGlyph/ElementTypeGlyph';
import { ReorderButtons, type ReorderButtonsContext } from '../ReorderButtons/ReorderButtons';
import { Text } from '../Text/Text';
import { compareBySiblingOrder } from '../../elements/siblingOrder';
import styles from './ValueStreamStagesSection.module.css';

export interface ValueStreamStagesSectionProps {
  orgSlug: string;
  modelSlug: string;
  /** The stream's own children (`ElementPageData.children`) — this section is stream-only, so every one of these is already a stage. */
  stages: readonly ElementsHeadRow[];
  /** F6/ADR-023: reordering stages is structural (`canEditValueStreamStructure`) — omitted entirely (not shown disabled), same convention as `CapabilityMapView`'s own `reorderCapability`, whenever the caller's own gate refuses it. */
  reorderContext?: ReorderButtonsContext | undefined;
}

/**
 * A value stream's own "Stages" section (F6/ADR-023): `StructureSection.tsx`'s
 * own "Children" shape, but ordered by `order` (`compareBySiblingOrder` —
 * the same comparator the Value streams page's own stage tiles use) rather
 * than the generic section's name order, since "stages left to right" is
 * meaningful sequence here, not an alphabetical accident.
 */
export function ValueStreamStagesSection({ orgSlug, modelSlug, stages, reorderContext }: ValueStreamStagesSectionProps) {
  if (stages.length === 0) return <EmptyState>No stages recorded yet.</EmptyState>;

  const ordered = [...stages].sort(compareBySiblingOrder);
  return (
    <ul className={styles.list}>
      {ordered.map((stage, index) => (
        <li key={stage.element_id} className={styles.row}>
          <Link to={`/o/${orgSlug}/m/${modelSlug}/e/${stage.element_id}`} className={styles.link}>
            <ElementTypeGlyph type={stage.element_type} />
            <Text as="span">{stage.name}</Text>
          </Link>
          {reorderContext && (
            <ReorderButtons elementType="value_stream" element={stage} previous={ordered[index - 1]} next={ordered[index + 1]} siblings={ordered} context={reorderContext} />
          )}
        </li>
      ))}
    </ul>
  );
}
