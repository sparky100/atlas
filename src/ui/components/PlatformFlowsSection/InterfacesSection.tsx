import { Link } from 'react-router';
import type { UUID } from '../../../contracts/delta';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../../contracts/rows';
import { INTERFACE_TYPE_LABELS } from '../../../contracts/attributeSchema';
import { attributesRecord } from '../../elements/attributesRecord';
import { ElementTypeGlyph } from '../ElementTypeGlyph/ElementTypeGlyph';
import { EmptyState } from '../EmptyState/EmptyState';
import { Text } from '../Text/Text';
import styles from './PlatformFlowsSection.module.css';

export interface InterfacesSectionProps {
  orgSlug: string;
  modelSlug: string;
  /** The integration platform's own container children — its interfaces (ADR-026). */
  interfaces: readonly ElementsHeadRow[];
  /** Every flow via the platform or any of its interfaces, to count each interface's own. */
  flows: readonly RelationshipsHeadRow[];
}

/**
 * ADR-026: an integration platform's interfaces — what it exposes or
 * consumes (an API, a file drop, a topic…) — each with its type and how many
 * flows go through it. Several flows through one interface is the reuse the
 * ADR reads rather than stores.
 */
export function InterfacesSection({ orgSlug, modelSlug, interfaces, flows }: InterfacesSectionProps) {
  if (interfaces.length === 0) {
    return <EmptyState>No interfaces recorded yet — the APIs, files, topics or jobs this platform exposes or consumes.</EmptyState>;
  }
  const countByInterface = new Map<UUID, number>();
  for (const flow of flows) {
    const via = attributesRecord(flow.attributes).via;
    if (typeof via === 'string') countByInterface.set(via, (countByInterface.get(via) ?? 0) + 1);
  }
  return (
    <ul className={styles.list}>
      {[...interfaces]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((iface) => {
          const type = attributesRecord(iface.attributes).interfaceType;
          const typeLabel = typeof type === 'string' && type in INTERFACE_TYPE_LABELS ? INTERFACE_TYPE_LABELS[type as keyof typeof INTERFACE_TYPE_LABELS] : 'Type not set';
          const count = countByInterface.get(iface.element_id) ?? 0;
          return (
            <li key={iface.element_id} className={styles.row}>
              <div className={styles.endpoints}>
                <Link to={`/o/${orgSlug}/m/${modelSlug}/e/${iface.element_id}`} className={styles.link}>
                  <ElementTypeGlyph type="container" />
                  <Text as="span">{iface.name}</Text>
                </Link>
                <Text as="span" tone="muted" size="sm">
                  {typeLabel} · {count} {count === 1 ? 'flow' : 'flows'}
                </Text>
              </div>
            </li>
          );
        })}
    </ul>
  );
}
