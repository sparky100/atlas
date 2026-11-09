import { SlidersHorizontal } from 'lucide-react';
import type { Ref } from 'react';
import { Link } from 'react-router';
import type { UUID } from '../../contracts/delta';
import type { ElementsHeadRow } from '../../contracts/rows';
import { Chip, type ChipTone } from '../components/Chip/Chip';
import { CollapsibleSection } from '../components/CollapsibleSection/CollapsibleSection';
import { Text } from '../components/Text/Text';
import { attributesRecord } from '../elements/attributesRecord';
import { criticalityToneFor } from '../elements/criticalityTone';
import { domainToneFor } from '../elements/systemDomain';
import { lifecycleToneFor } from '../elements/lifecycleTone';
import { LandscapeFilterBar } from './LandscapeFilterBar';
import type { LandscapeFilters } from './landscapeFilter';
import type { LandscapeInspectorNeighbour, LandscapeInspectorSupport } from './landscapeInspectorSelection';
import type { LandscapeLane, LandscapeLaneOption } from './layout';
import styles from './LandscapeInspectorContent.module.css';

function capitalize(value: string): string {
  return value.length === 0 ? value : value.charAt(0).toUpperCase() + value.slice(1);
}

/** A string attribute rendered as a `Chip`, only when it's actually set — never a defaulted value passed off as a recorded fact (CLAUDE.md rule 4). Mirrors `landscapeColour.ts`'s own stance of showing the raw attribute value as the label, not a separate display-string map. */
function AttributeChip({ label, value, toneFor }: { label: string; value: unknown; toneFor?: (value: string) => ChipTone | undefined }) {
  if (typeof value !== 'string' || value.length === 0) return null;
  return (
    <div className={styles.attributeRow}>
      <Text as="span" size="sm" tone="muted">
        {label}
      </Text>
      <Chip tone={toneFor?.(value) ?? 'neutral'}>{value}</Chip>
    </div>
  );
}

/**
 * V2b's Inspector, Landscape's own content — the four sections the prompt
 * names (Selection/Connections/Filters/Actions), rendered inside the shared
 * `<Inspector>` shell (`Inspector.tsx`). Pure presentation over data
 * `LandscapePage.tsx` already has loaded (`useLandscape`'s `edges`/
 * `supportsEdges`/`ownsEdges`, `l1AncestorByCapabilityId`) — no fetch of its
 * own, same "hook does the loading, component just renders" split every
 * other landscape component already follows.
 *
 * Connections also carries the view-options toggles and the per-lane
 * collapse/pin list that used to live in `LandscapeFocusPanel.tsx` (deleted
 * once this replaced it) — not named in the original ask, but dropping
 * working, tested functionality with nowhere else to put it would have been
 * a real regression (UI-principles.md §6.5 records this same call).
 */
export interface LandscapeInspectorContentProps {
  focusedElement: ElementsHeadRow | null;
  neighbours: readonly LandscapeInspectorNeighbour[];
  ownersByRole: ReadonlyMap<string, readonly ElementsHeadRow[]>;
  supports: readonly LandscapeInspectorSupport[];
  elementHref: (elementId: UUID) => string;
  /** Omitted (no "Context →" action) for an actor — same "no context diagram of its own" gate `ElementHeader.tsx`'s own `contextHref` prop comment documents. */
  contextHref?: ((elementId: UUID) => string) | undefined;
  /** `LandscapeFocusPanel.tsx`'s own "Clear" button, carried over — Escape/clicking empty canvas (`LandscapeCanvas.tsx`) already clears focus, but dropping the one visible affordance for it here too would still be a real regression for a reader who never discovers the keyboard path. */
  onClearFocus: () => void;

  routeViaPlatforms: boolean;
  onRouteViaPlatformsChange: (value: boolean) => void;
  showConnections: boolean;
  onShowConnectionsChange: (value: boolean) => void;
  /** Show people and teams that only own things (no `uses`/`flows_to` line) — hidden by default. */
  showOwners: boolean;
  onShowOwnersChange: (value: boolean) => void;
  lanes: readonly LandscapeLane[];
  /** Every lane key+label this model could ever place a system in, regardless of hidden state (`layout.ts`'s `listLandscapeLaneOptions`) — `lanes` above alone can't drive this list, since a hidden lane drops out of it entirely with no way back. */
  laneOptions: readonly LandscapeLaneOption[];
  pinnedLaneKeys: readonly string[];
  hiddenLaneKeys: readonly string[];
  onSetLaneCollapsed: (key: string, collapsed: boolean) => void;
  onSetLanePinned: (key: string, pinned: boolean) => void;
  onReorderPinnedLane: (key: string, direction: 'up' | 'down') => void;
  onSetLaneHidden: (key: string, hidden: boolean) => void;

  filters: LandscapeFilters;
  onFiltersChange: (filters: LandscapeFilters) => void;
  capabilityOptions: readonly { id: UUID; name: string }[];
  /** §8.8's `f` shortcut (`LandscapePage.tsx`'s own `openFilterBar`) — attached to the Filters section's own content div so that handler can find and open its `<details>` facets once the section actually exists in the DOM. */
  filtersSectionRef?: Ref<HTMLDivElement>;
}

export function LandscapeInspectorContent({
  focusedElement,
  neighbours,
  ownersByRole,
  supports,
  elementHref,
  contextHref,
  onClearFocus,
  routeViaPlatforms,
  onRouteViaPlatformsChange,
  showConnections,
  onShowConnectionsChange,
  showOwners,
  onShowOwnersChange,
  lanes,
  laneOptions,
  pinnedLaneKeys,
  hiddenLaneKeys,
  onSetLaneCollapsed,
  onSetLanePinned,
  onReorderPinnedLane,
  onSetLaneHidden,
  filters,
  onFiltersChange,
  capabilityOptions,
  filtersSectionRef,
}: LandscapeInspectorContentProps) {
  const attrs = focusedElement ? attributesRecord(focusedElement.attributes) : {};

  return (
    <>
      <CollapsibleSection title="Selection">
        {focusedElement ? (
          <div className={styles.selection}>
            <div className={styles.selectionHeader}>
              <Text as="p" size="sm" className={styles.selectionName}>
                {focusedElement.name}
              </Text>
              <button type="button" className={styles.clearFocus} onClick={onClearFocus}>
                Clear
              </button>
            </div>
            <AttributeChip label="Type" value={capitalize(focusedElement.element_type)} />
            <AttributeChip label="Lifecycle" value={attrs.lifecycleStatus} toneFor={lifecycleToneFor} />
            <AttributeChip label="Criticality" value={attrs.criticality} toneFor={criticalityToneFor} />
            <AttributeChip label="Domain" value={attrs.domain} toneFor={domainToneFor} />
            {ownersByRole.size > 0 && (
              <div className={styles.subsection}>
                <Text as="h3" size="sm" tone="muted">
                  Owners
                </Text>
                <ul className={styles.list}>
                  {[...ownersByRole.entries()].map(([role, owners]) => (
                    <li key={role}>
                      <Text as="span" size="sm" tone="muted">
                        {capitalize(role)}:{' '}
                      </Text>
                      {owners.map((owner, i) => (
                        <span key={owner.element_id}>
                          {i > 0 && ', '}
                          <Link to={elementHref(owner.element_id)}>{owner.name}</Link>
                        </span>
                      ))}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {supports.length > 0 && (
              <div className={styles.subsection}>
                <Text as="h3" size="sm" tone="muted">
                  Supports
                </Text>
                <ul className={styles.list}>
                  {supports.map((s) => (
                    <li key={s.capabilityId}>
                      <Link to={elementHref(s.capabilityId)}>{s.capabilityName}</Link>
                      {s.role && (
                        <Text as="span" size="sm" tone="muted">
                          {' '}
                          ({s.role})
                        </Text>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <Text as="p" size="sm" tone="muted">
            Nothing focused. Click a system or actor on the canvas to inspect it.
          </Text>
        )}
      </CollapsibleSection>

      <CollapsibleSection title="Connections" meta={neighbours.length > 0 ? `(${String(neighbours.length)})` : undefined}>
        <div className={styles.viewOptions}>
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={showConnections}
              onChange={(e) => {
                onShowConnectionsChange(e.target.checked);
              }}
            />
            <Text as="span" size="sm" tone="muted">
              Show connections
            </Text>
          </label>
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={showOwners}
              onChange={(e) => {
                onShowOwnersChange(e.target.checked);
              }}
            />
            <Text as="span" size="sm" tone="muted">
              Show owners (people and teams)
            </Text>
          </label>
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={routeViaPlatforms}
              onChange={(e) => {
                onRouteViaPlatformsChange(e.target.checked);
              }}
            />
            <Text as="span" size="sm" tone="muted">
              Route via platforms
            </Text>
          </label>
        </div>

        {focusedElement && (
          <ul className={styles.list}>
            {neighbours.length === 0 && (
              <li>
                <Text as="span" size="sm" tone="muted">
                  No neighbours.
                </Text>
              </li>
            )}
            {neighbours.map((n) => (
              <li key={n.relationshipId} className={styles.neighbourRow}>
                <span aria-hidden="true">{n.outbound ? '→' : '←'}</span>
                <Text as="span" size="sm">
                  {n.verb} <Link to={elementHref(n.otherId)}>{n.otherName}</Link>
                  {n.description && (
                    <Text as="span" size="sm" tone="muted">
                      {' '}
                      ({n.description})
                    </Text>
                  )}
                </Text>
              </li>
            ))}
          </ul>
        )}

        {laneOptions.length > 0 && (
          <ul className={styles.laneList}>
            {laneOptions.map((option) => {
              const hidden = hiddenLaneKeys.includes(option.key);
              // A hidden lane has no layout entry at all (`layout.ts`'s own
              // `boundaryKeys` filter) — its row shows only its label and
              // the way back (the show button), never the now-meaningless
              // collapse/pin controls for a lane nothing is drawing.
              if (hidden) {
                return (
                  <li key={option.key} className={styles.laneRow}>
                    <Text as="span" size="sm" tone="faint" className={styles.laneLabel}>
                      {option.label}
                    </Text>
                    <button
                      type="button"
                      className={styles.pinButton}
                      aria-label={`Show ${option.label} lane`}
                      onClick={() => {
                        onSetLaneHidden(option.key, false);
                      }}
                    >
                      👁️‍🗨️
                    </button>
                  </li>
                );
              }
              const lane = lanes.find((l) => l.key === option.key);
              if (!lane) return null;
              const pinned = pinnedLaneKeys.includes(lane.key);
              const pinIndex = pinnedLaneKeys.indexOf(lane.key);
              return (
                <li key={lane.key} className={styles.laneRow}>
                  <button
                    type="button"
                    className={styles.laneDisclosure}
                    aria-label={`${lane.collapsed ? 'Expand' : 'Collapse'} ${lane.label} lane`}
                    aria-expanded={!lane.collapsed}
                    onClick={() => {
                      onSetLaneCollapsed(lane.key, !lane.collapsed);
                    }}
                  >
                    <span aria-hidden="true">{lane.collapsed ? '▸' : '▾'}</span>
                  </button>
                  <Text as="span" size="sm" className={styles.laneLabel}>
                    {lane.label}
                  </Text>
                  {pinned && (
                    <span className={styles.laneReorder}>
                      <button type="button" aria-label={`Move ${lane.label} lane up`} disabled={pinIndex <= 0} onClick={() => { onReorderPinnedLane(lane.key, 'up'); }}>
                        ↑
                      </button>
                      <button
                        type="button"
                        aria-label={`Move ${lane.label} lane down`}
                        disabled={pinIndex === pinnedLaneKeys.length - 1}
                        onClick={() => {
                          onReorderPinnedLane(lane.key, 'down');
                        }}
                      >
                        ↓
                      </button>
                    </span>
                  )}
                  <button
                    type="button"
                    className={styles.pinButton}
                    aria-pressed={pinned}
                    aria-label={`${pinned ? 'Unpin' : 'Pin'} ${lane.label} lane`}
                    onClick={() => {
                      onSetLanePinned(lane.key, !pinned);
                    }}
                  >
                    {pinned ? '📌' : '📍'}
                  </button>
                  <button
                    type="button"
                    className={styles.pinButton}
                    aria-label={`Hide ${lane.label} lane`}
                    onClick={() => {
                      onSetLaneHidden(lane.key, true);
                    }}
                  >
                    🙈
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        title={
          <span className={styles.filtersTitle}>
            <SlidersHorizontal size={14} aria-hidden="true" /> Filters
          </span>
        }
      >
        <div ref={filtersSectionRef}>
          <LandscapeFilterBar filters={filters} onChange={onFiltersChange} capabilityOptions={capabilityOptions} />
        </div>
      </CollapsibleSection>

      {focusedElement && (
        <CollapsibleSection title="Actions">
          <div className={styles.actions}>
            <Link to={elementHref(focusedElement.element_id)}>Open element →</Link>
            {contextHref && <Link to={contextHref(focusedElement.element_id)}>Context →</Link>}
          </div>
        </CollapsibleSection>
      )}
    </>
  );
}
