import { useId, useState } from 'react';
import { Link } from 'react-router';
import type { ActorSubtype, UUID } from '../../contracts/delta';
import type { RelationshipsHeadRow } from '../../contracts/rows';
import { AiAgentTag } from '../components/AiAgentTag/AiAgentTag';
import { aiAutonomyOf } from '../../engine/elementRead/aiAgent';
import { Chip } from '../components/Chip/Chip';
import { ElementTypeGlyph } from '../components/ElementTypeGlyph/ElementTypeGlyph';
import { Text } from '../components/Text/Text';
import { attributesRecord } from '../elements/attributesRecord';
import { lifecycleToneFor } from '../elements/lifecycleTone';
import { edgeLabel, type ContextGroup, type ContextNeighbour } from './contextGrouping';
import styles from './ContextMobileList.module.css';

export interface ContextMobileListProps {
  group: ContextGroup;
  elementHref: (elementId: UUID) => string;
  /** Systems and containers only — an actor neighbour has no Context view of its own (same reasoning `ContextDiagramCanvas.tsx`'s own prop comment gives). */
  neighbourContextHref: (elementId: UUID) => string;
}

type DirectionKey = 'uses' | 'used-by' | 'flows-out' | 'flows-in' | 'people';

const DIRECTION_LABEL: Record<DirectionKey, string> = { uses: 'Uses', 'used-by': 'Used by', 'flows-out': 'Flows out', 'flows-in': 'Flows in', people: 'People' };
const DIRECTION_ORDER: DirectionKey[] = ['uses', 'used-by', 'flows-out', 'flows-in', 'people'];

interface DirectionRow {
  neighbour: ContextNeighbour;
  edge: RelationshipsHeadRow;
}

/**
 * V1's own mobile content (<768px, mirroring `LandscapeMobileList.tsx`'s
 * "same content as a list grouped by direction" precedent for the
 * identical desktop-canvas → mobile-list problem): one row per
 * (neighbour, edge) pair — a neighbour with both an inbound and an
 * outbound edge to the hub appears once per direction, not once overall,
 * since each edge is its own fact worth its own row (V1's own "incoming
 * and outgoing distinguished"). An actor-type neighbour always lands in
 * "People" regardless of which edge reached it — the person glyph already
 * marks it as different from a system/container row, so a further
 * uses/used-by split would just be noise for the one group that's already
 * distinguished by icon.
 */
export function ContextMobileList({ group, elementHref, neighbourContextHref }: ContextMobileListProps) {
  const [expandedKey, setExpandedKey] = useState<DirectionKey | null>(null);

  const rowsByDirection = new Map<DirectionKey, DirectionRow[]>();
  for (const neighbour of [...group.internal, ...group.external]) {
    for (const edge of neighbour.edges) {
      const key = directionOf(neighbour, edge, group.hub.element_id);
      const list = rowsByDirection.get(key) ?? [];
      list.push({ neighbour, edge });
      rowsByDirection.set(key, list);
    }
  }

  function toggle(key: DirectionKey): void {
    setExpandedKey((current) => (current === key ? null : key));
  }

  return (
    <div className={styles.list} role="list">
      {DIRECTION_ORDER.map((key) => {
        const rows = rowsByDirection.get(key);
        if (!rows || rows.length === 0) return null;
        return (
          <AccordionGroup key={key} label={DIRECTION_LABEL[key]} count={rows.length} expanded={expandedKey === key} onToggle={() => { toggle(key); }}>
            <ul className={styles.rows}>
              {rows.map(({ neighbour, edge }) => (
                <NeighbourRow
                  key={`${key}-${edge.relationship_id}`}
                  neighbour={neighbour}
                  edge={edge}
                  hubId={group.hub.element_id}
                  elementHref={elementHref}
                  neighbourContextHref={neighbourContextHref}
                />
              ))}
            </ul>
          </AccordionGroup>
        );
      })}
    </div>
  );
}

function directionOf(neighbour: ContextNeighbour, edge: RelationshipsHeadRow, hubId: UUID): DirectionKey {
  if (neighbour.element.element_type === 'actor') return 'people';
  const outbound = edge.from_element_id === hubId;
  if (edge.relationship_type === 'flows_to') return outbound ? 'flows-out' : 'flows-in';
  return outbound ? 'uses' : 'used-by';
}

function AccordionGroup({ label, count, expanded, onToggle, children }: { label: string; count: number; expanded: boolean; onToggle: () => void; children: React.ReactNode }) {
  const panelId = useId();
  return (
    <div className={styles.group}>
      <button type="button" className={styles.groupHeader} aria-expanded={expanded} aria-controls={panelId} onClick={onToggle}>
        <Text as="span" size="lg" className={styles.groupName}>
          {label}
        </Text>
        <Text as="span" size="sm" tone="muted">
          {count} {count === 1 ? 'connection' : 'connections'}
        </Text>
        <span className={styles.chevron} aria-hidden="true">
          {expanded ? '▾' : '▸'}
        </span>
      </button>
      {expanded && (
        <div id={panelId} className={styles.groupBody}>
          {children}
        </div>
      )}
    </div>
  );
}

function NeighbourRow({
  neighbour,
  edge,
  hubId,
  elementHref,
  neighbourContextHref,
}: {
  neighbour: ContextNeighbour;
  edge: RelationshipsHeadRow;
  hubId: UUID;
  elementHref: (id: UUID) => string;
  neighbourContextHref: (id: UUID) => string;
}) {
  const element = neighbour.element;
  const attrs = attributesRecord(element.attributes);
  const external = attrs.isExternal === true;
  const actorSubtype = element.element_type === 'actor' && typeof attrs.subtype === 'string' ? (attrs.subtype as ActorSubtype) : undefined;
  const lifecycleStatus = (element.element_type === 'system' || element.element_type === 'container') && typeof attrs.lifecycleStatus === 'string' ? attrs.lifecycleStatus : null;
  const lifecycleTone = lifecycleStatus !== null ? lifecycleToneFor(lifecycleStatus) : undefined;
  const autonomy = element.element_type === 'system' ? aiAutonomyOf(element) : null;
  // Only an actor neighbour has no Context view of its own (S1 item 11a) —
  // a container gets one just like a system does, per V3.
  const href = element.element_type === 'system' || element.element_type === 'container' ? neighbourContextHref(element.element_id) : elementHref(element.element_id);

  return (
    <li className={styles.row}>
      <Link to={href} className={styles.rowMain}>
        <ElementTypeGlyph type={element.element_type} external={external} {...(actorSubtype !== undefined ? { actorSubtype } : {})} />
        <Text as="span" className={styles.rowName}>
          {neighbour.displayName}
        </Text>
        {autonomy !== null && <AiAgentTag autonomy={autonomy} />}
        {lifecycleTone !== undefined && lifecycleStatus !== null && <span className={styles.lifecycleDot} data-tone={lifecycleTone} role="img" aria-label={lifecycleStatus} title={lifecycleStatus} />}
        {/* V1's mobile list groups by direction, not internal/external (its
            own wording never asks for a second split) — "external" stays a
            real, accessible fact per row instead, the same badge the hub's
            own header already uses for itself. */}
        {external && <Chip tone="neutral">external</Chip>}
      </Link>
      <Text as="span" size="sm" tone="muted" className={styles.rowVerb}>
        {edgeLabel(edge, hubId)}
      </Text>
    </li>
  );
}
