import { Text } from '../components/Text/Text';
import styles from './LandscapeFocusPanel.module.css';

export interface LandscapeFocusPanelLane {
  key: string;
  label: string;
  collapsed: boolean;
}

export interface LandscapeFocusPanelProps {
  /** Prompt 7k item 4, relocated here (decision: "'Route via platforms' moves into the focus panel") — identical accessible name (`getByRole('checkbox', { name: 'Route via platforms' })`) so `e2e/integration-platforms.spec.ts`'s existing locator keeps working once the panel is open. */
  routeViaPlatforms: boolean;
  onRouteViaPlatformsChange: (value: boolean) => void;
  /** V2: "edges hidden by default; 'Show connections' toggle" — grouped here alongside "Route via platforms" as this canvas's other edge-display view option; a judgment call (the plan names no specific home for this control), following the same reasoning "Route via platforms" itself already gives for living in a view-options panel rather than the header. */
  showConnections: boolean;
  onShowConnectionsChange: (value: boolean) => void;
  /**
   * Every lane in the *current* layout, already in its resolved pin/sort
   * order (`layout.lanes`, unchanged) — a lane a filter has hidden
   * entirely simply isn't listed here, same as it isn't drawn on the
   * canvas; there's nothing to collapse or pin for a lane with no pixels.
   */
  lanes: readonly LandscapeFocusPanelLane[];
  pinnedLaneKeys: readonly string[];
  onSetLaneCollapsed: (key: string, collapsed: boolean) => void;
  onSetLanePinned: (key: string, pinned: boolean) => void;
  onReorderPinnedLane: (key: string, direction: 'up' | 'down') => void;
  /** V2 decision 2: the active focus summary — omitted (not shown) while nothing is focused. */
  focusedElementName?: string | null;
  focusNeighbourCount?: number;
  onClearFocus?: () => void;
}

/**
 * V2 "landscape focus and filters": view options ("Route via platforms",
 * "Show connections") plus the per-lane collapse/pin controls (decision 1)
 * plus the active-focus summary — a real DOM panel, not canvas-drawn
 * controls, so every one of these stays keyboard- and screen-reader-
 * operable (§8.7's "every canvas interaction has a keyboard/list
 * equivalent") even though focus/lane-collapse both originate on the
 * canvas itself.
 */
export function LandscapeFocusPanel({
  routeViaPlatforms,
  onRouteViaPlatformsChange,
  showConnections,
  onShowConnectionsChange,
  lanes,
  pinnedLaneKeys,
  onSetLaneCollapsed,
  onSetLanePinned,
  onReorderPinnedLane,
  focusedElementName,
  focusNeighbourCount = 0,
  onClearFocus,
}: LandscapeFocusPanelProps) {
  return (
    <div className={styles.panel} aria-label="View options">
      {focusedElementName && (
        <div className={styles.focusSummary}>
          <Text as="span" size="sm">
            Focused: {focusedElementName} · {focusNeighbourCount} {focusNeighbourCount === 1 ? 'neighbour' : 'neighbours'}
          </Text>
          <button type="button" className={styles.clearFocus} onClick={onClearFocus}>
            Clear
          </button>
        </div>
      )}

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

      {lanes.length > 0 && (
        <ul className={styles.laneList}>
          {lanes.map((lane) => {
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
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
