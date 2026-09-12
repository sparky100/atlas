import { Link } from 'react-router';
import type { UUID } from '../../contracts/delta';
import { Chip } from '../components/Chip/Chip';
import { ElementTypeGlyph } from '../components/ElementTypeGlyph/ElementTypeGlyph';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { Text } from '../components/Text/Text';
import { attributesRecord } from '../elements/attributesRecord';
import { lifecycleToneFor } from '../elements/lifecycleTone';
import type { CapabilityLandscapeRow, CapabilityLandscapeRows } from './capabilityLandscapeRows';
import styles from './CapabilityLandscapeList.module.css';

export interface CapabilityLandscapeListProps {
  rows: CapabilityLandscapeRows;
  /** Tap/click target for both a system's own name and its owner's — same "→ element page" target every other landscape row uses. */
  elementHref: (elementId: UUID) => string;
  /** The row's own separate "Context →" link — a module has no Context view of its own (`LandscapeMobileList.tsx`'s identical `isModule` reasoning), so it's the one row kind that omits this. */
  contextHref: (systemId: UUID) => string;
}

/**
 * Sprint U4-2c item 2: "/landscape?capability=X ... a flat list of the
 * systems supporting X, sectioned Primary / Also supports ... No lanes, no
 * cross-lane chips." One renderer for every viewport width — unlike the
 * lane-based landscape's own desktop-canvas/mobile-list split
 * (`LandscapeCanvas.tsx`/`LandscapeMobileList.tsx`), this list has no
 * pixels to lay out and nothing that behaves differently on a small screen.
 */
export function CapabilityLandscapeList({ rows, elementHref, contextHref }: CapabilityLandscapeListProps) {
  if (rows.count === 0) {
    return <EmptyState>No systems support this capability yet.</EmptyState>;
  }
  return (
    <div className={styles.list}>
      <Section title="Primary" rows={rows.primary} elementHref={elementHref} contextHref={contextHref} />
      <Section title="Also supports" rows={rows.secondary} elementHref={elementHref} contextHref={contextHref} />
    </div>
  );
}

interface SectionProps {
  title: string;
  rows: readonly CapabilityLandscapeRow[];
  elementHref: (elementId: UUID) => string;
  contextHref: (systemId: UUID) => string;
}

function Section({ title, rows, elementHref, contextHref }: SectionProps) {
  // An empty section (every supporter is primary, or every one is
  // secondary) is a real, expected shape — omitted rather than shown with
  // a "(0)" count and no rows under it.
  if (rows.length === 0) return null;
  return (
    <section className={styles.section}>
      <Text as="h2" size="lg" className={styles.sectionTitle}>
        {title} ({rows.length})
      </Text>
      <ul className={styles.rows}>
        {rows.map((row) => (
          <Row key={row.system.element_id} row={row} elementHref={elementHref} contextHref={contextHref} />
        ))}
      </ul>
    </section>
  );
}

function Row({ row, elementHref, contextHref }: { row: CapabilityLandscapeRow; elementHref: (elementId: UUID) => string; contextHref: (systemId: UUID) => string }) {
  const { system, role, viaCapability, owner, usesCount, usedByCount } = row;
  const attrs = attributesRecord(system.attributes);
  const external = attrs.isExternal === true;
  const lifecycleStatus = typeof attrs.lifecycleStatus === 'string' ? attrs.lifecycleStatus : null;
  const lifecycleTone = lifecycleStatus !== null ? lifecycleToneFor(lifecycleStatus) : undefined;
  // See `elementHref`/`contextHref`'s own prop comments.
  const isModule = system.element_type === 'container';
  // "(only when non-zero)" — item 2's own words: the whole "uses N · used
  // by N" clause is omitted, not shown as "uses 0 · used by 0", the moment
  // both counts are zero.
  const showUsage = usesCount > 0 || usedByCount > 0;

  return (
    <li className={styles.row}>
      <Link to={elementHref(system.element_id)} className={styles.rowMain}>
        <ElementTypeGlyph type={system.element_type} external={external} />
        <Text as="span" className={styles.rowName}>
          {system.name}
        </Text>
        {lifecycleTone !== undefined && lifecycleStatus !== null && <span className={styles.lifecycleDot} data-tone={lifecycleTone} role="img" aria-label={lifecycleStatus} title={lifecycleStatus} />}
        <Chip tone={role === 'primary' ? 'info' : 'neutral'}>{role}</Chip>
        {/* "Child capabilities' systems included with the child named" — only ever set when this row's own edge targets a descendant of the root, never the root itself (`capabilityLandscapeRows.ts`'s own `viaCapability` doc comment). */}
        {viaCapability && <Chip tone="neutral">via {viaCapability.name}</Chip>}
      </Link>
      <div className={styles.rowSecondary}>
        <Text as="span" size="sm" tone="muted">
          Owner:{' '}
          {owner ? (
            <Link to={elementHref(owner.element_id)}>{owner.name}</Link>
          ) : (
            <Text as="span" size="sm" tone="faint">
              —
            </Text>
          )}
        </Text>
        {showUsage && (
          <Text as="span" size="sm" tone="muted">
            uses {usesCount} · used by {usedByCount}
          </Text>
        )}
        {!isModule && (
          <Link to={contextHref(system.element_id)} className={styles.contextLink}>
            Context →
          </Link>
        )}
      </div>
    </li>
  );
}
