import { useEffect, useState } from 'react';

/**
 * E8 item (4): "non-critical panels ... load after first paint." Returns
 * `false` on mount and flips to `true` two animation frames later — the
 * same double-rAF wait `useRouteTiming.ts` already uses to mark its own
 * `first-paint` checkpoint (one rAF only guarantees the *next* frame is
 * queued, not that the browser has actually painted it yet; see that
 * hook's own doc comment).
 *
 * A caller gates a non-critical fetch's own effect on this value instead
 * of firing it unconditionally on mount, so the request for a panel like
 * "Health findings" or "Recent activity" — data the page's main content
 * never needs to render — genuinely starts after the critical path has
 * painted, not merely in parallel with it.
 */
export function useAfterFirstPaint(): boolean {
  const [afterFirstPaint, setAfterFirstPaint] = useState(false);

  useEffect(() => {
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        setAfterFirstPaint(true);
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, []);

  return afterFirstPaint;
}
