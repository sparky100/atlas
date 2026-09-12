import styles from './CommentMarkerButton.module.css';

export type CommentMarkerState = { state: 'ink'; count: number } | { state: 'hollow' };

export interface CommentMarkerButtonProps {
  marker: CommentMarkerState;
  onClick: () => void;
}

/**
 * S1 item 12: "markers and panel on the mobile landscape list and the
 * capability-scoped list" — the same "ink" (at least one open thread) /
 * "hollow" (every thread resolved) marker `CapabilityTile.tsx` already
 * draws for the capability map (M1 close-out item 2), and
 * `LandscapeCanvas.tsx` draws on its own canvas — factored out here since
 * this item adds two more call sites (`LandscapeMobileList.tsx`'s
 * `SystemRow`, `CapabilityLandscapeList.tsx`'s `Row`) that would
 * otherwise duplicate the same aria-label/click logic a third and fourth
 * time. `CapabilityTile.tsx`'s own inline marker is left as-is (a working,
 * tested `position: absolute` corner badge tied to that component's own
 * "whole tile is the click target" stretched-link layout) — this is a
 * plain inline badge instead, for a linear list row, not a tile corner.
 *
 * `onClick` always calls `e.preventDefault()`/`e.stopPropagation()` before
 * invoking the caller's own handler — every call site so far renders this
 * inside (or alongside) a row whose own primary content is a `<Link>` or
 * a click target of its own; a marker click must never also follow that
 * link or accordion-toggle the row it sits in.
 */
export function CommentMarkerButton({ marker, onClick }: CommentMarkerButtonProps) {
  return (
    <button
      type="button"
      className={styles.marker}
      data-state={marker.state}
      aria-label={marker.state === 'ink' ? `${String(marker.count)} unresolved comment${marker.count === 1 ? '' : 's'}` : 'All comments resolved'}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
    >
      {marker.state === 'ink' ? marker.count : null}
    </button>
  );
}
