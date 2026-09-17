import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Text } from '../Text/Text';
import styles from './Inspector.module.css';

export interface InspectorProps {
  /** The resting state with nothing selected — `useInspectorCollapsedPreference`'s own saved value. Ignored (forced open) while `hasSelection` is true — see this component's own module comment. */
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Whether something is currently focused/selected on the calling view — forces the panel open regardless of `collapsed`, per the prompt's own "collapsed... when nothing is focused; opens on focus." */
  hasSelection: boolean;
  /** The sections — `InspectorSection` (this same directory) per section, in display order. Left entirely to the caller: Landscape's own Selection/Connections/Filters content is nothing Context or Capability map necessarily share, only this shell (collapse mechanics, fixed width, the persisted resting state) does. */
  children: ReactNode;
}

/**
 * V2b's shared right-side panel — "one component shared by landscape,
 * context and capability map" (the prompt's own words). Collapsible to a
 * slim icon strip at a fixed width; resizable is explicitly deferred (the
 * human's own scope correction when this was planned: "collapsible at a
 * fixed width first ... drag-to-resize is a later refinement, not this
 * sprint").
 *
 * Visibility is the union of two things, not one flag: the user's own
 * saved resting preference (`collapsed`, remembered per user via
 * `useInspectorCollapsedPreference`) and whether anything is currently
 * selected (`hasSelection`) — a selection always wins, so clicking a node
 * always reveals its own details even if the panel was last left
 * collapsed, and the *next* visit with nothing selected respects
 * whatever the user last chose. The collapse button itself always writes
 * to the saved preference, whether or not a selection is currently
 * forcing the panel open — so collapsing while something is selected has
 * no visible effect yet, but takes effect the moment the selection clears.
 *
 * Fixed width (not resizable, see above), sitting beside the canvas as an
 * ordinary flex sibling — `LandscapePage.module.css`'s own `.canvasRow`
 * already gives the canvas `flex: 1` and leaves this panel to size itself,
 * so collapsing/expanding reflows the canvas for free through the same
 * `ResizeObserver` that already measures `<main>` (`useCanvasWidth.ts`),
 * no bespoke reflow mechanism needed.
 */
export function Inspector({ collapsed, onToggleCollapsed, hasSelection, children }: InspectorProps) {
  const open = hasSelection || !collapsed;

  if (!open) {
    return (
      <div className={styles.strip} aria-label="Inspector">
        <button type="button" className={styles.toggleButton} aria-label="Expand inspector" title="Expand inspector" onClick={onToggleCollapsed}>
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <aside className={styles.panel} aria-label="Inspector">
      <div className={styles.header}>
        <Text as="h2" size="lg">
          Inspector
        </Text>
        <button type="button" className={styles.toggleButton} aria-label="Collapse inspector" title="Collapse inspector" onClick={onToggleCollapsed}>
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </div>
      <div className={styles.body}>{children}</div>
    </aside>
  );
}
