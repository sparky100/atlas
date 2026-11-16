import { Link } from 'react-router';
import type { UUID } from '../../contracts/delta';
import { AiTag } from '../components/AiTag/AiTag';
import { aiMarkOf } from '../../engine/elementRead/aiAgent';
import { Chip } from '../components/Chip/Chip';
import { CommentMarkerButton } from '../components/CommentMarkerButton/CommentMarkerButton';
import { commentMarkerFor } from '../components/CommentMarkerButton/commentMarkerFor';
import { ElementTypeGlyph } from '../components/ElementTypeGlyph/ElementTypeGlyph';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { Text } from '../components/Text/Text';
import { attributesRecord } from '../elements/attributesRecord';
import { lifecycleToneFor } from '../elements/lifecycleTone';
import type { CapabilityLandscapeRow, CapabilityLandscapeRows } from './capabilityLandscapeRows';
import { supportsRoleLabel } from './supportsRoleLabel';
import styles from './CapabilityLandscapeList.module.css';

export interface CapabilityLandscapeListProps {
  rows: CapabilityLandscapeRows;
  /** Tap/click target for both a system's own name and its owner's — same "→ element page" target every other landscape row uses. */
  elementHref: (elementId: UUID) => string;
  /** The row's own separate "Context →" link — a module has no Context view of its own (`LandscapeMobileList.tsx`'s identical `isModule` reasoning), so it's the one row kind that omits this. */
  contextHref: (systemId: UUID) => string;
  /** S1 item 12: "markers ... on the capability-scoped list" — see `LandscapeMobileList.tsx`'s identical prop for the shared marker convention this reuses. */
  threadCounts?: ReadonlyMap<UUID, { open: number; total: number }> | undefined;
  onCommentMarkerClick?: ((elementId: UUID) => void) | undefined;
}


/**
 * Sprint U4-2c item 2: "/landscape?capability=X ... a flat list of the
 * systems supporting X, sectioned Primary / Also supports ... No lanes, no
 * cross-lane chips." One renderer for every viewport width — unlike the
 * lane-based landscape's own desktop-canvas/mobile-list split
 * (`LandscapeCanvas.tsx`/`LandscapeMobileList.tsx`), this list has no
 * pixels to lay out and nothing that behaves differently on a small screen.
 */
export function CapabilityLandscapeList({ rows, elementHref, contextHref, threadCounts, onCommentMarkerClick }: CapabilityLandscapeListProps) {
  if (rows.count === 0) {
    return <EmptyState>No systems support this capability yet.</EmptyState>;
  }
  return (
    <div className={styles.list}>
      <Section title="Main systems" rows={rows.primary} elementHref={elementHref} contextHref={contextHref} threadCounts={threadCounts} onCommentMarkerClick={onCommentMarkerClick} />
      <Section title="Other systems" rows={rows.secondary} elementHref={elementHref} contextHref={contextHref} threadCounts={threadCounts} onCommentMarkerClick={onCommentMarkerClick} />
    </div>
  );
}

interface SectionProps {
  title: string;
  rows: readonly CapabilityLandscapeRow[];
  elementHref: (elementId: UUID) => string;
  contextHref: (systemId: UUID) => string;
  threadCounts: ReadonlyMap<UUID, { open: number; total: number }> | undefined;
  onCommentMarkerClick: ((elementId: UUID) => void) | undefined;
}

function Section({ title, rows, elementHref, contextHref, threadCounts, onCommentMarkerClick }: SectionProps) {
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
          <Row
            key={row.system.element_id}
            row={row}
            elementHref={elementHref}
            contextHref={contextHref}
            marker={commentMarkerFor(row.system.element_id, threadCounts)}
            onCommentMarkerClick={onCommentMarkerClick}
          />
        ))}
      </ul>
    </section>
  );
}

function Row({
  row,
  elementHref,
  contextHref,
  marker,
  onCommentMarkerClick,
}: {
  row: CapabilityLandscapeRow;
  elementHref: (elementId: UUID) => string;
  contextHref: (systemId: UUID) => string;
  marker: ReturnType<typeof commentMarkerFor>;
  onCommentMarkerClick: ((elementId: UUID) => void) | undefined;
}) {
  const { system, role, viaCapability, owner, usesCount, usedByCount } = row;
  const attrs = attributesRecord(system.attributes);
  const external = attrs.isExternal === true;
  const lifecycleStatus = typeof attrs.lifecycleStatus === 'string' ? attrs.lifecycleStatus : null;
  const lifecycleTone = lifecycleStatus !== null ? lifecycleToneFor(lifecycleStatus) : undefined;
  const mark = system.element_type === 'system' ? aiMarkOf(system) : null;
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
        {mark !== null && <AiTag mark={mark} />}
        {lifecycleTone !== undefined && lifecycleStatus !== null && <span className={styles.lifecycleDot} data-tone={lifecycleTone} role="img" aria-label={lifecycleStatus} title={lifecycleStatus} />}
        <Chip tone={role === 'primary' ? 'info' : 'neutral'}>{supportsRoleLabel(role)}</Chip>
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
        {marker && (
          <CommentMarkerButton
            marker={marker}
            onClick={() => {
              onCommentMarkerClick?.(system.element_id);
            }}
          />
        )}
      </div>
    </li>
  );
}
