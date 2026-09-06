import { Link } from 'react-router';
import type { ElementVersionDiff, RelationshipVersionDiff, VersionDiff } from '../../engine/versionDiff';
import { CollapsibleSection } from '../components/CollapsibleSection/CollapsibleSection';
import { DiffBadge } from '../components/DiffBadge/DiffBadge';
import { DiffLegend } from '../components/DiffBadge/DiffLegend';
import { ElementTypeGlyph } from '../components/ElementTypeGlyph/ElementTypeGlyph';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { Text } from '../components/Text/Text';
import styles from './VersionDiffView.module.css';

export interface VersionDiffViewProps {
  diff: VersionDiff;
  orgSlug: string;
  modelSlug: string;
  /** An element only in `asIs` (removed) has no page at `toBe`'s ref — link it at `asIs`'s instead, so "Removed" rows are still a real, working link, not a link into nothing. */
  toBeRefParam: string;
  asIsRefParam: string;
}

/**
 * The version diff's renderer (UI-principles §6.2/§6.3). A plain list,
 * grouped by state, not a canvas — same reasoning as Context/Container/
 * Component's own view components: no §8.6 performance budget applies to
 * "what changed between two tags", and a list is §8.7's own accessible
 * form besides. Unchanged elements/relationships are counted, not listed
 * — the point of a diff is what's different, and a model-wide list of
 * "unchanged" rows would bury that in noise no director asked to see;
 * §6.3's own greyscale/opacity treatment for "Unchanged" nodes is a canvas
 * concept (a dimmed shape still in its place) that doesn't translate to a
 * list the same way.
 */
export function VersionDiffView({ diff, orgSlug, modelSlug, toBeRefParam, asIsRefParam }: VersionDiffViewProps) {
  const elementName = new Map<string, string>();
  for (const e of diff.elements) {
    elementName.set(e.elementId, (e.toBe ?? e.asIs)?.name ?? e.elementId);
  }

  const added = diff.elements.filter((e) => e.state === 'added');
  const removed = diff.elements.filter((e) => e.state === 'removed');
  const changed = diff.elements.filter((e) => e.state === 'changed');
  const moved = diff.elements.filter((e) => e.state === 'moved');
  const unchangedCount = diff.elements.filter((e) => e.state === 'unchanged').length;

  const relAdded = diff.relationships.filter((r) => r.state === 'added');
  const relRemoved = diff.relationships.filter((r) => r.state === 'removed');
  const relChanged = diff.relationships.filter((r) => r.state === 'changed');
  const relUnchangedCount = diff.relationships.filter((r) => r.state === 'unchanged').length;

  const elementHref = (e: ElementVersionDiff) => `/o/${orgSlug}/m/${modelSlug}/e/${e.elementId}?ref=${e.toBe ? toBeRefParam : asIsRefParam}`;

  const nothingChanged = added.length === 0 && removed.length === 0 && changed.length === 0 && moved.length === 0 && relAdded.length === 0 && relRemoved.length === 0 && relChanged.length === 0;

  return (
    <div>
      <DiffLegend />

      {nothingChanged && <EmptyState>No differences between these two versions.</EmptyState>}

      {!nothingChanged && (
        <>
          <CollapsibleSection title="Elements" meta={`(${String(added.length + removed.length + changed.length + moved.length)} changed, ${String(unchangedCount)} unchanged)`}>
            {added.length === 0 && removed.length === 0 && changed.length === 0 && moved.length === 0 ? (
              <EmptyState>No element changes.</EmptyState>
            ) : (
              <ul className={styles.list}>
                {[...added, ...removed, ...changed, ...moved].map((e) => (
                  <ElementDiffRow key={e.elementId} diff={e} href={elementHref(e)} />
                ))}
              </ul>
            )}
          </CollapsibleSection>

          <CollapsibleSection title="Relationships" meta={`(${String(relAdded.length + relRemoved.length + relChanged.length)} changed, ${String(relUnchangedCount)} unchanged)`}>
            {relAdded.length === 0 && relRemoved.length === 0 && relChanged.length === 0 ? (
              <EmptyState>No relationship changes.</EmptyState>
            ) : (
              <ul className={styles.list}>
                {[...relAdded, ...relRemoved, ...relChanged].map((r) => (
                  <RelationshipDiffRow key={r.relationshipId} diff={r} elementName={elementName} />
                ))}
              </ul>
            )}
          </CollapsibleSection>
        </>
      )}
    </div>
  );
}

function ElementDiffRow({ diff, href }: { diff: ElementVersionDiff; href: string }) {
  const row = diff.toBe ?? diff.asIs;
  if (!row) return null;
  return (
    <li className={styles.row}>
      <div className={styles.rowTitle}>
        <ElementTypeGlyph type={row.elementType} />
        <Link to={href}>
          <Text as="span">{row.name}</Text>
        </Link>
      </div>
      <div className={styles.rowMeta}>
        <DiffBadge state={diff.state} changedCount={diff.state === 'changed' ? diff.changedAttributes.length : undefined} />
        {diff.changedAttributes.length > 0 && (
          <Text as="span" size="sm" tone="muted">
            {diff.changedAttributes.join(', ')}
          </Text>
        )}
      </div>
    </li>
  );
}

function RelationshipDiffRow({ diff, elementName }: { diff: RelationshipVersionDiff; elementName: Map<string, string> }) {
  const row = diff.toBe ?? diff.asIs;
  if (!row) return null;
  const fromName = elementName.get(row.fromElementId) ?? row.fromElementId;
  const toName = elementName.get(row.toElementId) ?? row.toElementId;
  return (
    <li className={styles.row}>
      <Text as="span">
        {row.relationshipType} {fromName} → {toName}
      </Text>
      <DiffBadge state={diff.state} changedCount={diff.state === 'changed' ? diff.changedAttributes.length : undefined} />
    </li>
  );
}
