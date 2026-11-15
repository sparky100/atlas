import { useEffect, useRef, type RefObject } from 'react';

interface ViewTransform {
  scale: number;
  tx: number;
  ty: number;
}

/**
 * Keeps a pan/zoom canvas looking right when its box changes size (window
 * resize, side panel opening, a bigger monitor). The canvases only redrew on
 * resize before, so the diagram stayed pinned to the old fit: off-centre,
 * clipped or floating in empty space.
 *
 * On each size change: if the view is still exactly the "fit" for the
 * previous size (the user has not panned or zoomed), it re-fits to the new
 * size. If the user has moved the view, their zoom is kept and the point at
 * the middle of the view stays at the middle.
 *
 * `computeFit` and `getTransform` are read through refs, so callers can pass
 * fresh closures every render without re-creating the observer.
 */
export function useRefitOnResize(
  wrapperRef: RefObject<HTMLElement | null>,
  getTransform: () => ViewTransform,
  setTransform: (next: ViewTransform) => void,
  computeFit: (displayWidth: number, displayHeight: number) => ViewTransform,
): void {
  const latest = useRef({ getTransform, setTransform, computeFit });
  latest.current = { getTransform, setTransform, computeFit };

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper || typeof ResizeObserver === 'undefined') return undefined;
    let prevWidth = wrapper.clientWidth;
    let prevHeight = wrapper.clientHeight;
    const observer = new ResizeObserver(() => {
      const width = wrapper.clientWidth;
      const height = wrapper.clientHeight;
      if (width === prevWidth && height === prevHeight) return;
      const { getTransform: get, setTransform: set, computeFit: fit } = latest.current;
      const current = get();
      const wasFitted = fit(prevWidth, prevHeight);
      const close = (a: number, b: number) => Math.abs(a - b) < 0.5;
      const untouched = close(current.scale, wasFitted.scale) && close(current.tx, wasFitted.tx) && close(current.ty, wasFitted.ty);
      if (width > 0 && height > 0) {
        if (untouched) set(fit(width, height));
        else set({ scale: current.scale, tx: current.tx + (width - prevWidth) / 2, ty: current.ty + (height - prevHeight) / 2 });
      }
      prevWidth = width;
      prevHeight = height;
    });
    observer.observe(wrapper);
    return () => {
      observer.disconnect();
    };
  }, [wrapperRef]);
}
