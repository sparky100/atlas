import { Link } from 'react-router';
import type { RelationshipsHeadRow } from '../../contracts/rows';
import type { UUID } from '../../contracts/delta';
import type { ElementVersionDiff, VersionDiff } from '../../engine/versionDiff';
import { Chip } from '../components/Chip/Chip';
import { LinkButton } from '../components/Button/LinkButton';
import { DiffBadge } from '../components/DiffBadge/DiffBadge';
import { ElementTypeGlyph } from '../components/ElementTypeGlyph/ElementTypeGlyph';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { Text } from '../components/Text/Text';
import { attributesRecord } from '../elements/attributesRecord';
import type { ContextGroup, ContextNeighbour } from './contextGrouping';
import styles from './ContextView.module.css';

// Prompt 7k item 2: "Business owner: Housing · Technical owner: IT
// Operations" — a fixed, deterministic role order (not alphabetical: reads
// business-first, the same priority `elementBrowse.ts`'s own owner-column
// preference gives it), each rendered only when at least one owner holds
// it. A role this product doesn't know about (shouldn't happen — `OwnsRole`
// is a closed union — but this reads plain strings off stored data) falls
// back to the raw value, capitalised, rather than being silently dropped.
const OWNS_ROLE_ORDER = ['business', 'technical', 'service'] as const;
function ownsRoleLabel(role: string): string {
  const known: Record<string, string> = { business: 'Business', technical: 'Technical', service: 'Service' };
  return known[role] ?? role.charAt(0).toUpperCase() + role.slice(1);
}

export interface ContextViewProps {
  group: ContextGroup;
  orgSlug: string;
  modelSlug: string;
  refParam: string;
  /** UI-principles §6.2/§6.3 — present only when a branch's Diff mode is active. This DOM view reuses `DiffBadge` (the same pill src/ui/versions/VersionDiffView.tsx already renders) rather than §6.3's canvas-specific border/fill/ghost treatment, which is written for shapes on a canvas, not list rows. */
  diff?: VersionDiff | null;
}


/**
 * The Context view's renderer (UI-principles §6.1: "one system, every
 * system/actor it has a relationship with... radial, scope at centre,
 * externals outside a ring"). Rendered as DOM/CSS, not Canvas — the same
 * departure the capability map already took (src/ui/capabilityMap/
 * CapabilityMapView.tsx's module comment) and for the same reason: §8.6's
 * 60fps/2,000-node performance budget is named for *a landscape view*
 * specifically; a system's own immediate neighbours are a bounded handful,
 * never that scale, so the simpler, accessible-by-default DOM renderer is
 * the right call here too, not a second Canvas layout engine for a shape
 * (radial rings) the landscape's lane-based one has no use for.
 *
 * Grouped, not laid out on a literal circle: "internal" and "external" are
 * two labelled lists rather than two concentric pixel radii — the same
 * relationship the ring metaphor describes (closer vs. further out), in a
 * form that is, per §8.7, already its own accessible view (a list), not a
 * diagram standing in need of one.
 *
 * Sprint U4-2b item 12: the hub block's own "Supports: ..."/"Owned by: ..."
 * lines (`.headerSummary` below) are real header content, not part of the
 * internal/external groups — `group.supports`/`group.owners` are exactly
 * the two things `contextGrouping.ts`'s own module comment already keeps
 * out of both (never a Context node, never a drawn edge). The empty-state
 * condition below still checks only `internal`/`external`/`owners` — a
 * system that supports a capability but connects to no other system or
 * actor is still "no connections to other systems or actors yet", even
 * though its own "Supports:" line renders above that message.
 */
export function ContextView({ group, orgSlug, modelSlug, refParam, diff = null }: ContextViewProps) {
  const elementHref = (elementId: UUID) => `/o/${orgSlug}/m/${modelSlug}/e/${elementId}?ref=${refParam}`;
  const containersHref = `/o/${orgSlug}/m/${modelSlug}/container/${group.hub.element_id}?ref=${refParam}`;
  const hubExternal = attributesRecord(group.hub.attributes).isExternal === true;
  const diffById = new Map<UUID, ElementVersionDiff>(diff?.elements.map((e) => [e.elementId, e]) ?? []);
  const hubDiff = diffById.get(group.hub.element_id);

  return (
    <div>
      <div className={styles.hub}>
        <div className={styles.hubTitle}>
          <ElementTypeGlyph type="system" external={hubExternal} />
          <Link to={elementHref(group.hub.element_id)}>
            <Text as="span" size="lg">
              {group.hub.name}
            </Text>
          </Link>
          {hubExternal && <Chip tone="neutral">external</Chip>}
          {diff && hubDiff && <DiffBadge state={hubDiff.state} changedCount={hubDiff.state === 'changed' ? hubDiff.changedAttributes.length : undefined} />}
        </div>
        {/* The one "descend a level" affordance this view offers (UI-principles §2.1's semantic zoom, as a discrete link rather than a continuous gesture this sprint doesn't build — see CapabilityMapView's own "→ Landscape" link for the same pattern one level up). */}
        <LinkButton to={containersHref} variant="secondary">
          Containers →
        </LinkButton>
      </div>

      {(group.supports.length > 0 || group.owners.length > 0) && (
        <div className={styles.headerSummary}>
          {/* Item 12: "Supports: <capabilities, primary first>", each one a
              link — computeContextGroup already sorted the list; this just
              renders it, and the capability's own element page is the link
              target (the same page every other Context/element-page link in
              this view already points at). */}
          {group.supports.length > 0 && (
            <Text as="p" tone="muted" size="sm">
              Supports:{' '}
              {group.supports.map((s, i) => (
                <span key={s.capability.element_id}>
                  {i > 0 && ', '}
                  <Link to={elementHref(s.capability.element_id)}>{s.capability.name}</Link>
                </span>
              ))}
            </Text>
          )}
          {group.owners.length > 0 && (
            <Text as="p" tone="muted" size="sm">
              {/* Prompt 7k item 2: grouped by role ("Business owner: Housing
                  · Technical owner: IT Operations"), not a single flat
                  "Owned by:" list — computeContextGroup already sorted
                  `owners` by role, so within each role group the actors are
                  already in the right order too. */}
              {OWNS_ROLE_ORDER.filter((role) => group.owners.some((o) => o.role === role)).map((role, groupIndex) => (
                <span key={role}>
                  {groupIndex > 0 && ' · '}
                  {ownsRoleLabel(role)} owner:{' '}
                  {group.owners
                    .filter((o) => o.role === role)
                    .map((owner, i) => (
                      <span key={owner.actor.element_id}>
                        {i > 0 && ', '}
                        <Link to={elementHref(owner.actor.element_id)}>{owner.actor.name}</Link>
                      </span>
                    ))}
                </span>
              ))}
            </Text>
          )}
        </div>
      )}

      {group.internal.length === 0 && group.external.length === 0 && group.owners.length === 0 && (
        <div>
          <EmptyState>No connections to other systems or actors yet.</EmptyState>
          <LinkButton to={elementHref(group.hub.element_id)} variant="secondary">
            Add a relationship on the element page →
          </LinkButton>
        </div>
      )}

      <div className={styles.groups}>
        {group.internal.length > 0 && (
          <div className={styles.group}>
            <Text as="h2" size="sm" tone="muted" className={styles.groupTitle}>
              Connections
            </Text>
            <NeighbourList neighbours={group.internal} hubId={group.hub.element_id} elementHref={elementHref} diffById={diff ? diffById : null} />
          </div>
        )}
        {group.external.length > 0 && (
          <div className={styles.group}>
            <Text as="h2" size="sm" tone="muted" className={styles.groupTitle}>
              External
            </Text>
            <NeighbourList neighbours={group.external} hubId={group.hub.element_id} elementHref={elementHref} diffById={diff ? diffById : null} />
          </div>
        )}
      </div>
    </div>
  );
}

function edgeLabel(edge: RelationshipsHeadRow, hubId: UUID): string {
  const outbound = edge.from_element_id === hubId;
  if (edge.relationship_type === 'flows_to') return outbound ? 'flows to ⇢' : '⇢ flows from';
  return outbound ? 'uses →' : '← used by';
}

function NeighbourList({ neighbours, hubId, elementHref, diffById }: { neighbours: ContextNeighbour[]; hubId: UUID; elementHref: (id: UUID) => string; diffById: Map<UUID, ElementVersionDiff> | null }) {
  return (
    <ul className={styles.neighbours}>
      {neighbours.map((neighbour) => {
        const external = attributesRecord(neighbour.element.attributes).isExternal === true;
        const neighbourDiff = diffById?.get(neighbour.element.element_id);
        return (
          <li key={neighbour.element.element_id} className={styles.neighbour}>
            <div className={styles.neighbourTitle}>
              <ElementTypeGlyph type={neighbour.element.element_type} external={external} />
              <Link to={elementHref(neighbour.element.element_id)}>
                <Text as="span">{neighbour.element.name}</Text>
              </Link>
              {diffById && neighbourDiff && <DiffBadge state={neighbourDiff.state} changedCount={neighbourDiff.state === 'changed' ? neighbourDiff.changedAttributes.length : undefined} />}
            </div>
            <Text as="span" size="sm" tone="muted">
              {neighbour.edges.map((edge) => edgeLabel(edge, hubId)).join(', ')}
            </Text>
          </li>
        );
      })}
    </ul>
  );
}
