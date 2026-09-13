import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { RelationshipsHeadRow } from '../../contracts/rows';
import type { UUID } from '../../contracts/delta';
import type { ElementVersionDiff, VersionDiff } from '../../engine/versionDiff';
import { DiffBadge } from '../components/DiffBadge/DiffBadge';
import { ElementTypeGlyph } from '../components/ElementTypeGlyph/ElementTypeGlyph';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { Text } from '../components/Text/Text';
import { attributesRecord } from '../elements/attributesRecord';
import type { StructureGroup } from './structureGrouping';
import styles from './StructureView.module.css';

export interface StructureViewProps {
  group: StructureGroup;
  orgSlug: string;
  modelSlug: string;
  /** The full `ref=...` query fragment (`refQueryParam`), not a bare token — see `CapabilityMapView.tsx`'s identical `refParam` doc comment for why. */
  refParam: string;
  /** UI-principles §6.2/§6.3 — present only when a branch's Diff mode is active. Reuses `DiffBadge`, same call as ContextView.tsx's own comment explains for this family of DOM views. */
  diff?: VersionDiff | null;
  /** Blocking: element creation's search-first "Add" control (an `ElementSearchAdd`, pre-built by the page with this frame's own `parentId`/branch already resolved) — omitted entirely, not shown disabled, when the caller hasn't established edit rights, same convention as `CapabilityMapView`'s `reorderCapability`. */
  addChild?: ReactNode;
}

function diffBadge(diffById: Map<UUID, ElementVersionDiff> | null, elementId: UUID) {
  const d = diffById?.get(elementId);
  if (!d) return null;
  return <DiffBadge state={d.state} changedCount={d.state === 'changed' ? d.changedAttributes.length : undefined} />;
}

/**
 * The Container view's renderer (UI-principles §6.1: "layered inside the
 * [parent] frame; externals outside"). DOM/CSS, not Canvas — same
 * reasoning as ContextView.tsx's module comment: no §8.6 performance
 * budget applies to one system's containers, which are never
 * landscape-scale.
 *
 * S1 item 18: this used to be shared with a Component view one level
 * deeper (a `kind: 'container' | 'component'` prop, a "Components →"
 * descend link on each container child) — the component level is gone
 * from the taxonomy entirely now, so a container card is a plain link to
 * its element page, nothing more, same as every other child here.
 */
export function StructureView({ group, orgSlug, modelSlug, refParam, diff = null, addChild }: StructureViewProps) {
  const elementHref = (elementId: UUID) => `/o/${orgSlug}/m/${modelSlug}/e/${elementId}?${refParam}`;
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
          {addChild}
        </div>

        {group.children.length === 0 && <EmptyState>No containers yet.</EmptyState>}

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
