import { Link } from 'react-router';
import type { RelationshipsHeadRow } from '../../contracts/rows';
import type { UUID } from '../../contracts/delta';
import { Button } from '../components/Button/Button';
import { Chip } from '../components/Chip/Chip';
import { ElementTypeGlyph } from '../components/ElementTypeGlyph/ElementTypeGlyph';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { Text } from '../components/Text/Text';
import { attributesRecord } from '../elements/attributesRecord';
import type { ContextGroup, ContextNeighbour } from './contextGrouping';
import styles from './ContextView.module.css';

export interface ContextViewProps {
  group: ContextGroup;
  orgSlug: string;
  modelSlug: string;
  refParam: string;
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
 */
export function ContextView({ group, orgSlug, modelSlug, refParam }: ContextViewProps) {
  const elementHref = (elementId: UUID) => `/o/${orgSlug}/m/${modelSlug}/e/${elementId}?ref=${refParam}`;
  const containersHref = `/o/${orgSlug}/m/${modelSlug}/container/${group.hub.element_id}?ref=${refParam}`;
  const hubExternal = attributesRecord(group.hub.attributes).isExternal === true;

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
        </div>
        {/* The one "descend a level" affordance this view offers (UI-principles §2.1's semantic zoom, as a discrete link rather than a continuous gesture this sprint doesn't build — see CapabilityMapView's own "→ Landscape" link for the same pattern one level up). */}
        <Link to={containersHref}>
          <Button variant="secondary">Containers →</Button>
        </Link>
      </div>

      {group.owners.length > 0 && (
        <div className={styles.owners}>
          <Text as="p" tone="muted" size="sm">
            Owned by {group.owners.map((owner) => owner.name).join(', ')}
          </Text>
        </div>
      )}

      {group.internal.length === 0 && group.external.length === 0 && group.owners.length === 0 && (
        <EmptyState>No relationships yet. Add a `uses`, `flows_to` or `owns` relationship from the element page to see it here.</EmptyState>
      )}

      <div className={styles.groups}>
        {group.internal.length > 0 && (
          <div className={styles.group}>
            <Text as="h2" size="sm" tone="muted" className={styles.groupTitle}>
              Connections
            </Text>
            <NeighbourList neighbours={group.internal} hubId={group.hub.element_id} elementHref={elementHref} />
          </div>
        )}
        {group.external.length > 0 && (
          <div className={styles.group}>
            <Text as="h2" size="sm" tone="muted" className={styles.groupTitle}>
              External
            </Text>
            <NeighbourList neighbours={group.external} hubId={group.hub.element_id} elementHref={elementHref} />
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

function NeighbourList({ neighbours, hubId, elementHref }: { neighbours: ContextNeighbour[]; hubId: UUID; elementHref: (id: UUID) => string }) {
  return (
    <ul className={styles.neighbours}>
      {neighbours.map((neighbour) => {
        const external = attributesRecord(neighbour.element.attributes).isExternal === true;
        return (
          <li key={neighbour.element.element_id} className={styles.neighbour}>
            <div className={styles.neighbourTitle}>
              <ElementTypeGlyph type={neighbour.element.element_type} external={external} />
              <Link to={elementHref(neighbour.element.element_id)}>
                <Text as="span">{neighbour.element.name}</Text>
              </Link>
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
