import { Link } from 'react-router';
import type { RelationshipsHeadRow } from '../../contracts/rows';
import type { UUID } from '../../contracts/delta';
import type { ElementVersionDiff, VersionDiff } from '../../engine/versionDiff';
import { LinkButton } from '../components/Button/LinkButton';
import { DiffBadge } from '../components/DiffBadge/DiffBadge';
import { ElementTypeGlyph } from '../components/ElementTypeGlyph/ElementTypeGlyph';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { Text } from '../components/Text/Text';
import { attributesRecord } from '../elements/attributesRecord';
import type { StructureGroup } from './structureGrouping';
import styles from './StructureView.module.css';

export interface StructureViewProps {
  kind: 'container' | 'component';
  group: StructureGroup;
  orgSlug: string;
  modelSlug: string;
  refParam: string;
  /** UI-principles §6.2/§6.3 — present only when a branch's Diff mode is active. Reuses `DiffBadge`, same call as ContextView.tsx's own comment explains for this family of DOM views. */
  diff?: VersionDiff | null;
}

function diffBadge(diffById: Map<UUID, ElementVersionDiff> | null, elementId: UUID) {
  const d = diffById?.get(elementId);
  if (!d) return null;
  return <DiffBadge state={d.state} changedCount={d.state === 'changed' ? d.changedAttributes.length : undefined} />;
}

/**
 * The Container/Component views' shared renderer (UI-principles §6.1:
 * "layered inside the [parent] frame; externals outside"). DOM/CSS, not
 * Canvas — same reasoning as ContextView.tsx's module comment: no §8.6
 * performance budget applies to one system's containers or one
 * container's components, which are never landscape-scale.
 *
 * Only Container's children (containers) get a "Components →" descend
 * link — Component is the zoom chain's last stop (UI-principles §2.1's
 * five levels end there), so a component card is a plain link to its
 * element page, nothing more.
 */
export function StructureView({ kind, group, orgSlug, modelSlug, refParam, diff = null }: StructureViewProps) {
  const elementHref = (elementId: UUID) => `/o/${orgSlug}/m/${modelSlug}/e/${elementId}?ref=${refParam}`;
  const componentsHref = (containerId: UUID) => `/o/${orgSlug}/m/${modelSlug}/component/${containerId}?ref=${refParam}`;
  const parentExternal = attributesRecord(group.parent.attributes).isExternal === true;
  const diffById = diff ? new Map<UUID, ElementVersionDiff>(diff.elements.map((e) => [e.elementId, e])) : null;

  return (
    <div>
      <div className={styles.frame}>
        <div className={styles.frameHeader}>
          <ElementTypeGlyph type={group.parent.element_type} external={parentExternal} />
          <Link to={elementHref(group.parent.element_id)}>
            <Text as="span" size="lg">
              {group.parent.name}
            </Text>
          </Link>
          {diffBadge(diffById, group.parent.element_id)}
        </div>

        {group.children.length === 0 && <EmptyState>{kind === 'container' ? 'No containers yet.' : 'No components yet.'} Add one from the element page.</EmptyState>}

        <div className={styles.children}>
          {group.children.map((child) => (
            <div key={child.element_id} className={styles.child}>
              <div className={styles.childTitle}>
                <ElementTypeGlyph type={child.element_type} external={attributesRecord(child.attributes).isExternal === true} />
                <Link to={elementHref(child.element_id)}>
                  <Text as="span">{child.name}</Text>
                </Link>
                {diffBadge(diffById, child.element_id)}
              </div>
              {kind === 'container' && (
                <LinkButton to={componentsHref(child.element_id)} variant="ghost">
                  Components →
                </LinkButton>
              )}
            </div>
          ))}
        </div>
      </div>

      {group.externals.length > 0 && (
        <div className={styles.externals}>
          <Text as="h2" size="sm" tone="muted" className={styles.externalsTitle}>
            External
          </Text>
          <ul className={styles.externalList}>
            {group.externals.map((external) => (
              <li key={external.element.element_id} className={styles.externalRow}>
                <div className={styles.childTitle}>
                  <ElementTypeGlyph type={external.element.element_type} external={attributesRecord(external.element.attributes).isExternal === true} />
                  <Link to={elementHref(external.element.element_id)}>
                    <Text as="span">{external.element.name}</Text>
                  </Link>
                  {diffBadge(diffById, external.element.element_id)}
                </div>
                <Text as="span" size="sm" tone="muted">
                  {external.edges.map((edge) => externalEdgeLabel(edge, group.children.map((c) => c.element_id))).join(', ')}
                </Text>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function externalEdgeLabel(edge: RelationshipsHeadRow, childIds: UUID[]): string {
  const outbound = childIds.includes(edge.from_element_id);
  if (edge.relationship_type === 'flows_to') return outbound ? 'flows to ⇢' : '⇢ flows from';
  return outbound ? 'uses →' : '← used by';
}
