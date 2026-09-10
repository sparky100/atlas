import { Link } from 'react-router';
import type { ElementsHeadRow } from '../../../contracts/rows';
import { Chip } from '../Chip/Chip';
import { ElementTypeGlyph } from '../ElementTypeGlyph/ElementTypeGlyph';
import { EmptyState } from '../EmptyState/EmptyState';
import { Text } from '../Text/Text';
import { attributesRecord } from '../../elements/attributesRecord';
import { lifecycleToneFor } from '../../elements/lifecycleTone';
import styles from './StructureSection.module.css';

export interface StructureSectionProps {
  orgSlug: string;
  modelSlug: string;
  parent: ElementsHeadRow | null;
  /** Capability only — computed from `parent_id` depth (ADR-016), `undefined` for every other element type. `null` means the chain doesn't resolve to a clean level 1–3 (shown as a gap, not hidden). */
  capabilityLevel?: number | null | undefined;
  children: ElementsHeadRow[];
}

function lifecycleOf(row: ElementsHeadRow): string | null {
  const value = attributesRecord(row.attributes).lifecycleStatus;
  return typeof value === 'string' ? value : null;
}

/**
 * §4.5: level (capability only, computed — see capabilityLevel prop),
 * parent and children. For a capability, the systems it supports repeat
 * here too — not yet built (needs the "supports" group's own data).
 *
 * Check C3 (docs/CHECK-U4-2a.md): "single-line facts inline ('Level 1',
 * 'Parent: Finance', 'Children: 5'); label-over-value only for values
 * that wrap." Level and Parent are each one short scalar/single link —
 * `.groupInline` puts the label and value on the same line, same
 * distinction §4.3's attribute rows already draw between a plain value
 * and one that needs its own block. Children keeps `.group`'s
 * label-over-value layout for the actual reason that rule exists: the
 * list of child links below the "Children (N)" summary genuinely wraps
 * across multiple lines, the same as any other list-shaped fact.
 */
export function StructureSection({ orgSlug, modelSlug, parent, capabilityLevel, children }: StructureSectionProps) {
  if (capabilityLevel === undefined && !parent && children.length === 0) {
    return <EmptyState>No parent or children — this element stands alone in the structure.</EmptyState>;
  }

  return (
    <div className={styles.section}>
      {capabilityLevel !== undefined && (
        <div className={styles.groupInline}>
          <Text tone="muted" size="sm" as="span">
            Level
          </Text>
          <Text as="span">{capabilityLevel ?? '— not a clean level 1–3 chain'}</Text>
        </div>
      )}
      {parent && (
        <div className={styles.groupInline}>
          <Text tone="muted" size="sm" as="span">
            Parent:
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
  const tone = lifecycle !== null ? lifecycleToneFor(lifecycle) : undefined;
  return (
    <Link to={`/o/${orgSlug}/m/${modelSlug}/e/${element.element_id}`} className={styles.link}>
      <ElementTypeGlyph type={element.element_type} />
      <Text as="span">{element.name}</Text>
      {lifecycle !== null && tone !== undefined && <Chip tone={tone}>{lifecycle}</Chip>}
    </Link>
  );
}
