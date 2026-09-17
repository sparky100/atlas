import { Link } from 'react-router';
import type { UUID } from '../../contracts/delta';
import { Chip } from '../components/Chip/Chip';
import { CollapsibleSection } from '../components/CollapsibleSection/CollapsibleSection';
import { Text } from '../components/Text/Text';
import { attributesRecord } from '../elements/attributesRecord';
import { lifecycleToneFor } from '../elements/lifecycleTone';
import { edgeLabel, type ContextNeighbour } from './contextGrouping';
import styles from './ContextInspectorContent.module.css';

function capitalize(value: string): string {
  return value.length === 0 ? value : value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * V2b's Inspector, Context's own content — the last of the three views in
 * the rollout order, inheriting the shell Landscape and Capability map
 * already proved. Two things needed a fresh decision here, both asked and
 * resolved before writing this:
 *
 * - Getting a neighbour into the Inspector: Context's diagram is Canvas
 *   2D, the same renderer Landscape's own canvas already uses, and — like
 *   Landscape, unlike Capability map's DOM tiles — click-to-focus was the
 *   chosen mechanism (`ContextDiagramCanvas.tsx`'s own doc comment): a
 *   first click on a neighbour tile focuses it (opens this content, no
 *   navigation); a second click on the already-focused tile navigates.
 *   The hub tile itself never enters focus — it already has a permanent
 *   header (`ContextView.tsx`'s own "Supports"/"Owned by" lines)
 *   describing it, so Selection here only ever describes a neighbour.
 * - No Filters section: unlike Landscape, Context has no filter strip to
 *   relocate, and unlike the assumption that carried over from Landscape's
 *   own rollout, the diagram's existing "Labels" toggle is left exactly
 *   where it is (the on-canvas toolbar, alongside Zoom/Fit) rather than
 *   moved in — it's viewport chrome tied to the canvas's own transform
 *   state, not a view option describing *content* the way Landscape's
 *   "Show connections"/"Route via platforms" were. A view with nothing to
 *   filter omits the section entirely (§6.5's own convention).
 *
 * Desktop-canvas only, like Landscape — `ContextPage.tsx`'s own comment
 * explains why the mobile list gets no Inspector of its own here (unlike
 * Capability map's mobile rows): `ContextMobileList.tsx`'s rows already
 * show a neighbour's name, type, lifecycle, external flag and edge verb
 * inline, so there's little the Inspector would add there.
 */
export interface ContextInspectorContentProps {
  focusedNeighbour: ContextNeighbour | null;
  hubId: UUID;
  elementHref: (elementId: UUID) => string;
  /** Systems and containers only — an actor neighbour has no Context view of its own, same gate `ContextDiagramCanvasProps`'s own `neighbourContextHref` prop already uses. */
  neighbourContextHref: (elementId: UUID) => string;
  onClearFocus: () => void;
}

export function ContextInspectorContent({ focusedNeighbour, hubId, elementHref, neighbourContextHref, onClearFocus }: ContextInspectorContentProps) {
  const element = focusedNeighbour?.element ?? null;
  const attrs = element ? attributesRecord(element.attributes) : {};
  const external = attrs.isExternal === true;
  const lifecycleStatus = element && (element.element_type === 'system' || element.element_type === 'container') && typeof attrs.lifecycleStatus === 'string' ? attrs.lifecycleStatus : null;
  const canGoToContext = element?.element_type === 'system' || element?.element_type === 'container';

  return (
    <>
      <CollapsibleSection title="Selection">
        {element ? (
          <div className={styles.selection}>
            <div className={styles.selectionHeader}>
              <Text as="p" size="sm" className={styles.selectionName}>
                {element.name}
              </Text>
              <button type="button" className={styles.clearFocus} onClick={onClearFocus}>
                Clear
              </button>
            </div>
            <div className={styles.attributeRow}>
              <Text as="span" size="sm" tone="muted">
                Type
              </Text>
              <Text as="span" size="sm">
                {capitalize(element.element_type)}
              </Text>
            </div>
            {lifecycleStatus !== null && (
              <div className={styles.attributeRow}>
                <Text as="span" size="sm" tone="muted">
                  Lifecycle
                </Text>
                <Chip tone={lifecycleToneFor(lifecycleStatus) ?? 'neutral'}>{lifecycleStatus}</Chip>
              </div>
            )}
            {external && (
              <div className={styles.attributeRow}>
                <Text as="span" size="sm" tone="muted">
                  Boundary
                </Text>
                <Chip tone="neutral">external</Chip>
              </div>
            )}
          </div>
        ) : (
          <Text as="p" size="sm" tone="muted">
            Nothing focused. Click a system, container or actor in the diagram to inspect it.
          </Text>
        )}
      </CollapsibleSection>

      {focusedNeighbour && (
        <CollapsibleSection title="Connections">
          <ul className={styles.list}>
            {focusedNeighbour.edges.map((edge) => (
              <li key={edge.relationship_id}>
                <Text as="span" size="sm">
                  {edgeLabel(edge, hubId)}
                </Text>
              </li>
            ))}
          </ul>
        </CollapsibleSection>
      )}

      {focusedNeighbour && (
        <CollapsibleSection title="Actions">
          <div className={styles.actions}>
            <Link to={elementHref(focusedNeighbour.element.element_id)}>Open element →</Link>
            {canGoToContext && <Link to={neighbourContextHref(focusedNeighbour.element.element_id)}>Context →</Link>}
          </div>
        </CollapsibleSection>
      )}
    </>
  );
}
