import { useId, useState } from 'react';
import { Link } from 'react-router';
import type { ReactNode } from 'react';
import type { ActorSubtype } from '../../contracts/delta';
import type { ElementsHeadRow } from '../../contracts/rows';
import type { UUID } from '../../contracts/delta';
import { Chip } from '../components/Chip/Chip';
import { CommentMarkerButton, type CommentMarkerState } from '../components/CommentMarkerButton/CommentMarkerButton';
import { commentMarkerFor } from '../components/CommentMarkerButton/commentMarkerFor';
import { ElementTypeGlyph } from '../components/ElementTypeGlyph/ElementTypeGlyph';
import { Text } from '../components/Text/Text';
import { attributesRecord } from '../elements/attributesRecord';
import { lifecycleToneFor } from '../elements/lifecycleTone';
import type { LandscapeGroupMember, LandscapeGroups } from './landscapeGroups';
import styles from './LandscapeMobileList.module.css';

export interface LandscapeMobileListProps {
  groups: LandscapeGroups;
  /** Tap target for both system and actor rows — their own element page (item 13's own words: "tap → element page"). */
  elementHref: (elementId: UUID) => string;
  /** The row's own separate "Context →" link — every row but an actor (V3: a container has a Context view of its own too now; an actor still has none, same reasoning `LandscapeCanvas.tsx`'s `actorHref` doc comment already gives). */
  contextHref: (systemId: UUID) => string;
  /**
   * S1 item 12: "markers ... on the mobile landscape list" — the same
   * map `LandscapePage.tsx` already fetches once for the desktop canvas
   * (`useThreadCounts`, keyed by `systemsById`'s ids) threaded through
   * here too; no second fetch. System-only, same as the canvas: an actor
   * row never carries a marker, `threadCounts` simply has no entry for
   * one either way.
   */
  threadCounts?: ReadonlyMap<UUID, { open: number; total: number }> | undefined;
  /** Required together with `threadCounts` — opens the comments panel scoped to the clicked row's own element. */
  onCommentMarkerClick?: ((elementId: UUID) => void) | undefined;
}


const ACTORS_GROUP_KEY = '$actors';

/**
 * Sprint U4-2b item 13: the mobile (<768px) landscape — this module's own
 * top comment (`landscapeGroups.ts`) explains the grouping this renders
 * and why. `LandscapePage.tsx` mounts this instead of `LandscapeCanvas`
 * below the same `useIsNarrowViewport(768)` breakpoint its own "+ Add"
 * disclosure already uses; the desktop canvas itself is untouched.
 *
 * One group open at a time (`expandedKey`) — the same accordion shape
 * `CapabilityMapView.tsx`'s own check-B6 mobile groups already established
 * for the identical UI problem (a long list of named collections, each
 * with its own members, on a narrow screen).
 */
export function LandscapeMobileList({ groups, elementHref, contextHref, threadCounts, onCommentMarkerClick }: LandscapeMobileListProps) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  function toggle(key: string): void {
    setExpandedKey((current) => (current === key ? null : key));
  }

  return (
    <div className={styles.list} role="list">
      {groups.actors.length > 0 && (
        <AccordionGroup
          label="Actors"
          count={groups.actors.length}
          countUnit="actor"
          expanded={expandedKey === ACTORS_GROUP_KEY}
          onToggle={() => {
            toggle(ACTORS_GROUP_KEY);
          }}
        >
          <ul className={styles.rows}>
            {groups.actors.map((actor) => (
              <ActorRow key={actor.element_id} actor={actor} elementHref={elementHref} />
            ))}
          </ul>
        </AccordionGroup>
      )}
      {groups.groups.map((group) => (
        <AccordionGroup
          key={group.key}
          label={group.label}
          count={group.members.length}
          countUnit="system"
          referencedBy={group.referencedBy}
          expanded={expandedKey === group.key}
          onToggle={() => {
            toggle(group.key);
          }}
        >
          {group.members.length === 0 ? (
            <Text as="p" tone="muted" size="sm" className={styles.emptyGroup}>
              No systems placed here directly — see the linked systems above.
            </Text>
          ) : (
            <ul className={styles.rows}>
              {group.members.map((member) => (
                <SystemRow
                  key={member.system.element_id}
                  member={member}
                  elementHref={elementHref}
                  contextHref={contextHref}
                  marker={commentMarkerFor(member.system.element_id, threadCounts)}
                  onCommentMarkerClick={onCommentMarkerClick}
                />
              ))}
            </ul>
          )}
        </AccordionGroup>
      ))}
    </div>
  );
}

interface AccordionGroupProps {
  label: string;
  count: number;
  countUnit: 'system' | 'actor';
  /** Item 13's own "shared-system chips" — the other systems referencing into this lane without a tile of their own (empty for the Actors group, which has no such concept). */
  referencedBy?: readonly ElementsHeadRow[];
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}

function AccordionGroup({ label, count, countUnit, referencedBy = [], expanded, onToggle, children }: AccordionGroupProps) {
  const panelId = useId();
  return (
    <div className={styles.group}>
      <button type="button" className={styles.groupHeader} aria-expanded={expanded} aria-controls={panelId} onClick={onToggle}>
        <span className={styles.groupHeaderText}>
          <Text as="span" size="lg" className={styles.groupName}>
            {label}
          </Text>
          <span className={styles.groupMeta}>
            <Text as="span" size="sm" tone="muted">
              {count} {countUnit}
              {count === 1 ? '' : 's'}
            </Text>
            {/* Secondary-supporter wording: "also: SAP", not "→ SAP" —
                these are still-collapsed hints that the full list (every
                supporting system, primary and secondary, each with its own
                role tag) is one tap away, not a diagram-style pointer. */}
            {referencedBy.length > 0 && (
              <span className={styles.referencedChips}>
                {referencedBy.map((system) => (
                  <Chip key={system.element_id} tone="neutral">
                    also: {system.name}
                  </Chip>
                ))}
              </span>
            )}
          </span>
        </span>
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

function ActorRow({ actor, elementHref }: { actor: ElementsHeadRow; elementHref: (id: UUID) => string }) {
  const attrs = attributesRecord(actor.attributes);
  const external = attrs.isExternal === true;
  const subtype = typeof attrs.subtype === 'string' ? (attrs.subtype as ActorSubtype) : undefined;
  return (
    <li className={styles.row}>
      <Link to={elementHref(actor.element_id)} className={styles.rowMain}>
        <ElementTypeGlyph type="actor" {...(subtype !== undefined ? { actorSubtype: subtype } : {})} external={external} />
        <Text as="span" className={styles.rowName}>
          {actor.name}
        </Text>
      </Link>
    </li>
  );
}

function SystemRow({
  member,
  elementHref,
  contextHref,
  marker,
  onCommentMarkerClick,
}: {
  member: LandscapeGroupMember;
  elementHref: (id: UUID) => string;
  contextHref: (id: UUID) => string;
  marker: CommentMarkerState | undefined;
  onCommentMarkerClick: ((elementId: UUID) => void) | undefined;
}) {
  const { system, extraLaneCount, usesCount, usedByCount, role } = member;
  const attrs = attributesRecord(system.attributes);
  const external = attrs.isExternal === true;
  const lifecycleStatus = typeof attrs.lifecycleStatus === 'string' ? attrs.lifecycleStatus : null;
  const lifecycleTone = lifecycleStatus !== null ? lifecycleToneFor(lifecycleStatus) : undefined;
  // S1 item 11a: an external actor is now a real member of the External
  // group (`landscapeGroups.ts`'s own `buildGroup` doc comment) — its own
  // subtype glyph (person/team/organisation), not the bare actor glyph.
  const actorSubtype = system.element_type === 'actor' && typeof attrs.subtype === 'string' ? (attrs.subtype as ActorSubtype) : undefined;

  // V3 ("container context pages"): a module tile's own element is a
  // Container (`system` here is really "the lane member," not always a
  // System), and now has a Context view of its own too, the same as an
  // ordinary system — only an actor still has no Context view to link to.
  const hasNoContextView = system.element_type === 'actor';

  return (
    <li className={styles.row}>
      <Link to={elementHref(system.element_id)} className={styles.rowMain}>
        <ElementTypeGlyph type={system.element_type} external={external} {...(actorSubtype !== undefined ? { actorSubtype } : {})} />
        <Text as="span" className={styles.rowName}>
          {system.name}
        </Text>
        {lifecycleTone !== undefined && lifecycleStatus !== null && <span className={styles.lifecycleDot} data-tone={lifecycleTone} role="img" aria-label={lifecycleStatus} title={lifecycleStatus} />}
        {/* Secondary-supporter wording: "expanded groups list every
            supporting system with a role tag" — `role` is only ever
            `undefined` for the four non-capability lanes (Unassigned/
            External/OT/Platforms, `landscapeGroups.ts`'s own doc comment),
            which have no single `supports` edge to name a role from. */}
        {role !== undefined && <Chip tone={role === 'primary' ? 'info' : 'neutral'}>{role}</Chip>}
        {extraLaneCount !== undefined && <Chip tone="neutral">+{extraLaneCount}</Chip>}
      </Link>
      <div className={styles.rowSecondary}>
        <Text as="span" size="sm" tone="muted">
          uses {usesCount} · used by {usedByCount}
        </Text>
        {!hasNoContextView && (
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
