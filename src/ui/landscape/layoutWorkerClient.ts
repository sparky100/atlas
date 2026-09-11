/**
 * The main-thread side of layout.worker.ts. One worker, created lazily and
 * reused across every layout computation for the life of the tab (spinning
 * one up per call would cost more than the layout computation itself for
 * a model this size) — a request-id keeps concurrent calls from crossing
 * wires if a second one is fired before the first replies.
 */
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import type { UUID } from '../../contracts/delta';
import { computeLandscapeLayout, MIN_LAYOUT_WIDTH, type LandscapeLayout } from './layout';
import type { LayoutWorkerRequest, LayoutWorkerResponse } from './layout.worker';

interface PendingRequest {
  resolve: (layout: LandscapeLayout) => void;
  reject: (error: Error) => void;
}

let worker: Worker | undefined;
let nextRequestId = 0;
const pending = new Map<number, PendingRequest>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./layout.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<LayoutWorkerResponse>) => {
      const entry = pending.get(event.data.requestId);
      if (!entry) return;
      pending.delete(event.data.requestId);
      entry.resolve(event.data.layout);
    };
    worker.onerror = (event) => {
      for (const entry of pending.values()) entry.reject(new Error(event.message));
      pending.clear();
    };
  }
  return worker;
}

/**
 * Runs `computeLandscapeLayout` off the main thread (UI-principles §8.6).
 * Falls back to computing it synchronously, in place, if `Worker` genuinely
 * isn't available (there is no such browser in practice; this is defensive
 * for an unusual host, not a routine code path) — everything drawing from
 * the result is written against a `Promise<LandscapeLayout>` either way, so
 * this is the only place that distinction lives.
 */
export function computeLandscapeLayoutInWorker(
  systems: readonly ElementsHeadRow[],
  supportsEdges: readonly RelationshipsHeadRow[],
  capabilitiesById: Map<UUID, ElementsHeadRow>,
  actors: readonly ElementsHeadRow[] = [],
  /** Item 7: the canvas's own on-screen width at layout time — see `layout.ts`'s own parameter doc. */
  layoutWidthHint: number = MIN_LAYOUT_WIDTH,
): Promise<LandscapeLayout> {
  if (typeof Worker === 'undefined') {
    return Promise.resolve(computeLandscapeLayout(systems, supportsEdges, capabilitiesById, actors, layoutWidthHint));
  }
  const requestId = nextRequestId++;
  return new Promise((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
    const request: LayoutWorkerRequest = { requestId, systems: [...systems], supportsEdges: [...supportsEdges], capabilities: [...capabilitiesById.entries()], actors: [...actors], layoutWidthHint };
    getWorker().postMessage(request);
  });
}
