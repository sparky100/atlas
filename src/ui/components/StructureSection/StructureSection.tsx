import { Link } from 'react-router';
import type { ElementsHeadRow } from '../../../contracts/rows';
import { Chip } from '../Chip/Chip';
import { ElementTypeGlyph } from '../ElementTypeGlyph/ElementTypeGlyph';
import { EmptyState } from '../EmptyState/EmptyState';
import { Text } from '../Text/Text';
import { attributesRecord } from '../../elements/attributesRecord';
import styles from './StructureSection.module.css';

export interface StructureSectionProps {
  orgSlug: string;
  modelSlug: string;
  parent: ElementsHeadRow | null;
  children: ElementsHeadRow[];
}

const LIFECYCLE_TONE = { planned: 'info', active: 'ok', retiring: 'warn', retired: 'neutral' } as const;

function lifecycleOf(row: ElementsHeadRow): string | null {
  const value = attributesRecord(row.attributes).lifecycleStatus;
  return typeof value === 'string' ? value : null;
}

/** §4.5: parent and children. For a capability, the systems it supports repeat here too — not yet built (needs the "supports" group's own data, wired once the landscape view's capability lens exists in step 4). */
export function StructureSection({ orgSlug, modelSlug, parent, children }: StructureSectionProps) {
  if (!parent && children.length === 0) {
    return <EmptyState>No parent or children — this element stands alone in the structure.</EmptyState>;
  }

  return (
    <div className={styles.section}>
      {parent && (
        <div className={styles.group}>
          <Text tone="muted" size="sm" as="span">
            Parent
          </Text>
          <ElementLink orgSlug={orgSlug} modelSlug={modelSlug} element={parent} />
        </div>
      )}
      {children.length > 0 && (
        <div className={styles.group}>
          <Text tone="muted" size="sm" as="span">
            Children ({children.length})
          </Text>
          <ul className={styles.list}>
            {children.map((child) => (
              <li key={child.element_id}>
                <ElementLink orgSlug={orgSlug} modelSlug={modelSlug} element={child} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ElementLink({ orgSlug, modelSlug, element }: { orgSlug: string; modelSlug: string; element: ElementsHeadRow }) {
  const lifecycle = lifecycleOf(element);
  return (
    <Link to={`/o/${orgSlug}/m/${modelSlug}/e/${element.element_id}`} className={styles.link}>
      <ElementTypeGlyph type={element.element_type} />
      <Text as="span">{element.name}</Text>
      {lifecycle !== null && lifecycle in LIFECYCLE_TONE && <Chip tone={LIFECYCLE_TONE[lifecycle as keyof typeof LIFECYCLE_TONE]}>{lifecycle}</Chip>}
    </Link>
  );
}
