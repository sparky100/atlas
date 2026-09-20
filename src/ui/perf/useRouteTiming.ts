import { useEffect, useRef } from 'react';

/**
 * E8 ("performance") phase 1's own instrument: a permanent, tiny RUM mark
 * so a Playwright timing spec (and real browser devtools) can read back
 * "resolve → first paint → data complete" per route without this codebase
 * hand-rolling network-waterfall capture too — `performance.getEntriesByType('resource')`
 * already gives that for free once a route's own fetches are in flight, so
 * this hook only needs to mark the three checkpoints E8's own wording names:
 *
 * - `atlas:<routeKey>:start` — this route's top-level page component
 *   mounted. The earliest point our own code can observe a route change;
 *   React Router has already resolved the URL by this point, so this is
 *   E8's "resolve", not a true navigation-start timestamp.
 * - `atlas:<routeKey>:first-paint` — two animation frames after mount, so
 *   the loading shell has actually painted, not just been scheduled (one
 *   rAF only guarantees the *next* frame is queued, not that the browser
 *   painted it yet).
 * - `atlas:<routeKey>:data-complete` — the first render where the page's
 *   own `ready` boolean is true.
 *
 * `routeKey` must be a stable, per-route string (e.g. `'capability-map'`)
 * — every mount of the same route reuses the same mark names, so a repeat
 * visit overwrites rather than accumulating marks a reader would otherwise
 * have to de-duplicate by timestamp.
 */
export function useRouteTiming(routeKey: string, ready: boolean): void {
  const dataMarked = useRef(false);

  useEffect(() => {
    dataMarked.current = false;
    performance.mark(`atlas:${routeKey}:start`);
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        performance.mark(`atlas:${routeKey}:first-paint`);
        performance.measure(`atlas:${routeKey}:resolve-to-paint`, `atlas:${routeKey}:start`, `atlas:${routeKey}:first-paint`);
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [routeKey]);

  useEffect(() => {
    if (!ready || dataMarked.current) return;
    dataMarked.current = true;
    performance.mark(`atlas:${routeKey}:data-complete`);
    performance.measure(`atlas:${routeKey}:resolve-to-data`, `atlas:${routeKey}:start`, `atlas:${routeKey}:data-complete`);
    try {
      // Only this measure can race the mount effect's own double-rAF: data
      // that's ready on the very first render (e.g. an instant/cached
      // response) fires this effect in the same commit as the mount effect
      // above, before `first-paint`'s rAFs have had a chance to run — a
      // real race, not a hypothetical one, so this one measure alone is
      // worth guarding rather than skipping.
      performance.measure(`atlas:${routeKey}:paint-to-data`, `atlas:${routeKey}:first-paint`, `atlas:${routeKey}:data-complete`);
    } catch {
      /* first-paint hasn't landed yet — see comment above. */
    }
  }, [routeKey, ready]);
}
