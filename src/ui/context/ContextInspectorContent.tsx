import { Link } from 'react-router';
import type { UUID } from '../../contracts/delta';
import { Chip } from '../components/Chip/Chip';
import { CollapsibleSection } from '../components/CollapsibleSection/CollapsibleSection';
import { Text } from '../components/Text/Text';
import { attributesRecord } from '../elements/attributesRecord';
import { lifecycleToneFor } from '../elements/lifecycleTone';
import { edgeLabel, type ContextGroup } from './contextGrouping';
import { contextInspectorFocusedNeighbour } from './contextInspectorSelection';
import styles from './ContextInspectorContent.module.css';
import { isSystemLikeType } from '../../contracts/elementKinds';

function capitalize(value: string): string {
  return value.length === 0 ? value : value.charAt(0).toUpperCase() + value.slice(1);
}

// Prompt 7k item 2: "Business owner: Housing · Technical owner: IT
// Operations" — a fixed, deterministic role order (not alphabetical: reads
// business-first, the same priority `elementBrowse.ts`'s own owner-column
// preference gives it), each rendered only when at least one owner holds
// it. A role this product doesn't know about (shouldn't happen — `OwnsRole`
// is a closed union — but this reads plain strings off stored data) falls
// back to the raw value, capitalised, rather than being silently dropped.
// Moved here from `ContextView.tsx` (Context layout v2, item 5) along with
// the "Supports:"/"Owned by:" rendering itself — see this file's own
// `HubFacts` for where it's used now.
const OWNS_ROLE_ORDER = ['business', 'technical', 'service'] as const;
function ownsRoleLabel(role: string): string {
  const known: Record<string, string> = { business: 'Business', technical: 'Technical', service: 'Service' };
  return known[role] ?? role.charAt(0).toUpperCase() + role.slice(1);
}

/**
 * The hub's own "Supports: ..."/"Owned by: ..." facts — V1's own header
 * lines, moved here for V2 item 5 ("the Inspector defaults to the centre
 * element on load; the header line is removed, it's in the Inspector
 * now"). Rendered only when the hub is the current selection (`HubFacts`'s
 * own caller) and there's at least one fact to show — same "omit rather
 * than show an empty section" convention every other Inspector section
 * here already uses.
 */
function HubFacts({ group, elementHref }: { group: ContextGroup; elementHref: (elementId: UUID) => string }) {
  if (group.supports.length === 0 && group.owners.length === 0) return null;
  const internalOwners = group.owners.filter((o) => !o.isExternal);
  const externalOwners = group.owners.filter((o) => o.isExternal);
  return (
    <CollapsibleSection title="Supports & ownership">
      <div className={styles.selection}>
        {group.supports.length > 0 && (
          <Text as="p" size="sm">
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
          <Text as="p" size="sm">
            {OWNS_ROLE_ORDER.filter((role) => internalOwners.some((o) => o.role === role)).map((role, groupIndex) => (
              <span key={role}>
                {groupIndex > 0 && ' · '}
                {ownsRoleLabel(role)} owner:{' '}
                {internalOwners
                  .filter((o) => o.role === role)
                  .map((owner, i) => (
                    <span key={owner.actor.element_id}>
                      {i > 0 && ', '}
                      <Link to={elementHref(owner.actor.element_id)}>{owner.actor.name}</Link>
                    </span>
                  ))}
              </span>
            ))}
            {/* S1 item 11a: an external owner can only ever hold role
                "service" (C20, src/engine/deltas.ts), and gets its own
                trailing "External:" clause naming the organisation, rather
                than folding it in as one more "Service owner" name
                indistinguishable from an internal one. */}
            {externalOwners.length > 0 && (
              <span>
                {internalOwners.length > 0 && ' · '}
                External:{' '}
                {externalOwners.map((owner, i) => (
                  <span key={owner.actor.element_id}>
                    {i > 0 && ', '}
                    <Link to={elementHref(owner.actor.element_id)}>{owner.externalOrganisation ?? owner.actor.name}</Link>
                  </span>
                ))}
              </span>
            )}
          </Text>
        )}
      </div>
    </CollapsibleSection>
  );
}

/**
 * V2b's Inspector, Context's own content — the last of the three views in
 * the rollout order, inheriting the shell Landscape and Capability map
 * already proved.
 *
 * V2 item 5 ("Inspector defaults to the centre element on load; the
 * 'Supports:' line above the canvas is removed — it's in the inspector"):
 * the hub is now a real, if implicit, selection — whenever
 * `focusedElementId` doesn't name a live neighbour (nothing has been
 * clicked yet, on load; the neighbour it named got cleared or is stale),
 * this falls back to showing the hub itself rather than an empty state.
 * The hub tile still never enters focus *via clicking* — a click on it
 * still navigates immediately, same as always (`ContextDiagramCanvasProps`'s
 * own `focusedElementId` doc comment) — this is purely about what the
 * Inspector shows when nothing else is focused. "Clear" (`onClearFocus`)
 * accordingly only appears once a neighbour actually has been clicked; the
 * hub view has nothing to clear back to, it *is* the default.
 *
 * Two other things needed a fresh decision, both asked and resolved before
 * writing the original version of this file:
 *
 * - Getting a neighbour into the Inspector: Context's diagram is Canvas
 *   2D, the same renderer Landscape's own canvas already uses, and — like
 *   Landscape, unlike Capability map's DOM tiles — click-to-focus was the
 *   chosen mechanism (`ContextDiagramCanvas.tsx`'s own doc comment): a
 *   first click on a neighbour tile focuses it (opens this content, no
 *   navigation); a second click on the already-focused tile navigates.
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
 * inline, so there's little the Inspector would add there. This does mean
 * the hub's own Supports/ownership facts, shown here, have no mobile
 * equivalent any more now that the header line is gone — accepted for now,
 * same as every other Inspector-only fact on mobile; the hub's own element
 * page still shows the underlying relationships either way.
 */
export interface ContextInspectorContentProps {
  group: ContextGroup;
  focusedElementId: UUID | null;
  elementHref: (elementId: UUID) => string;
  /** Systems and containers only — an actor neighbour has no Context view of its own, same gate `ContextDiagramCanvasProps`'s own `neighbourContextHref` prop already uses. */
  neighbourContextHref: (elementId: UUID) => string;
  onClearFocus: () => void;
}

export function ContextInspectorContent({ group, focusedElementId, elementHref, neighbourContextHref, onClearFocus }: ContextInspectorContentProps) {
  const focusedNeighbour = contextInspectorFocusedNeighbour(focusedElementId, group);
  const isHub = focusedNeighbour === null;
  const element = focusedNeighbour?.element ?? group.hub;
  const displayName = focusedNeighbour?.displayName ?? group.hubDisplayName;
  const attrs = attributesRecord(element.attributes);
  const external = attrs.isExternal === true;
  const lifecycleStatus = (isSystemLikeType(element.element_type)) && typeof attrs.lifecycleStatus === 'string' ? attrs.lifecycleStatus : null;
  const canGoToContext = !isHub && (isSystemLikeType(element.element_type));

  return (
    <>
      <CollapsibleSection title="Selection">
        <div className={styles.selection}>
          <div className={styles.selectionHeader}>
            <Text as="p" size="sm" className={styles.selectionName}>
              {displayName}
            </Text>
            {!isHub && (
              <button type="button" className={styles.clearFocus} onClick={onClearFocus}>
                Clear
              </button>
            )}
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
      </CollapsibleSection>

      {isHub ? (
        <HubFacts group={group} elementHref={elementHref} />
      ) : (
        <CollapsibleSection title="Connections">
          <ul className={styles.list}>
            {focusedNeighbour.edges.map((edge) => (
              <li key={edge.relationship_id}>
                <Text as="span" size="sm">
                  {edgeLabel(edge, group.hub.element_id)}
                </Text>
              </li>
            ))}
          </ul>
        </CollapsibleSection>
      )}

      <CollapsibleSection title="Actions">
        <div className={styles.actions}>
          <Link to={elementHref(element.element_id)}>Open element →</Link>
          {canGoToContext && <Link to={neighbourContextHref(element.element_id)}>Context →</Link>}
        </div>
      </CollapsibleSection>
    </>
  );
}
