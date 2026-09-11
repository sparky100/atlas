import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Sprint U4-2b item 7: "LAYOUT_WIDTH = canvas width at layout time (min
 * 1280)" — the live width of whatever element the returned `ref` is
 * attached to. `LandscapePage.tsx` attaches it to `<main>`, the canvas's
 * own containing block once it's showing (`LandscapePage.module.css`'s
 * `.mainWithCanvas` comment: `<main>` reaches the rail's own right edge
 * there) — `<main>` is rendered in every state (loading/ready/error), so a
 * width is available before the canvas itself ever mounts, and updates
 * again (via the same `ResizeObserver`) the moment `.mainWithCanvas`
 * actually applies once data is ready, converging on the real figure
 * within a layout tick or two rather than needing the canvas element
 * itself to exist first.
 *
 * Rounded to the nearest `bucketPx` (default 40 — a third of a tile's own
 * 160+24 column stride, small enough not to visibly under-fill a row, big
 * enough that a live window-resize drag doesn't re-trigger the worker-
 * dispatched layout on every intermediate pixel) — a genuinely new layout
 * run is the point of a real width change, not a debounce timer's
 * arbitrary delay.
 */
export function useCanvasWidth(bucketPx = 40): { ref: (el: HTMLElement | null) => void; width: number | null } {
  const [width, setWidth] = useState<number | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);

  const ref = useCallback(
    (el: HTMLElement | null) => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      if (!el || typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry) return;
        setWidth(Math.round(entry.contentRect.width / bucketPx) * bucketPx);
      });
      observer.observe(el);
      observerRef.current = observer;
    },
    [bucketPx],
  );

  useEffect(() => {
    return () => {
      observerRef.current?.disconnect();
    };
  }, []);

  return { ref, width };
}
