/**
 * The layout worker (UI-principles.md §8.6: "layout must run in a Web
 * Worker"). Pure message-passing glue around the already-tested
 * `computeLandscapeLayout` (src/ui/landscape/layout.ts) — nothing here is
 * itself worth a unit test; the function underneath is what's tested.
 *
 * Typed against `self`/`postMessage` via an explicit cast rather than the
 * TS `WebWorker` lib: this project's one tsconfig also loads `DOM` for
 * every other file, and `DOM`/`WebWorker` declare conflicting globals when
 * both are in scope — the cast keeps this file out of that conflict
 * without needing a second tsconfig just for worker files.
 */
import { computeLandscapeLayout, type LandscapeLaneDisplayOptions, type LandscapeLayout } from './layout';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import type { UUID } from '../../contracts/delta';

/** V2: the wire shape of `LandscapeLaneDisplayOptions` — plain arrays, not `Set`, for the same "portable across every structured-clone implementation" reasoning `capabilities` below already gives for `Map`. */
export interface LayoutWorkerLaneDisplay {
  collapsedLaneKeys?: string[];
  expandedLaneKeys?: string[];
  pinnedLaneKeys?: string[];
  hiddenLaneKeys?: string[];
}

export interface LayoutWorkerRequest {
  requestId: number;
  systems: ElementsHeadRow[];
  supportsEdges: RelationshipsHeadRow[];
  /** `Map` isn't guaranteed identical across every structured-clone implementation this app might run under — an entries array is the portable wire shape. */
  capabilities: [UUID, ElementsHeadRow][];
  actors: ElementsHeadRow[];
  /** Item 7: the canvas's own on-screen width at layout time — see `layout.ts`'s own parameter doc. */
  layoutWidthHint: number;
  /** V2: per-lane collapse/pin overrides — optional, omitted reproduces `computeLandscapeLayout`'s own pre-V2 default. */
  laneDisplay?: LayoutWorkerLaneDisplay;
}

export interface LayoutWorkerResponse {
  requestId: number;
  layout: LandscapeLayout;
}

interface WorkerLike {
  onmessage: ((event: MessageEvent<LayoutWorkerRequest>) => void) | null;
  postMessage: (message: LayoutWorkerResponse) => void;
}

const ctx = self as unknown as WorkerLike;

ctx.onmessage = (event) => {
  const { requestId, systems, supportsEdges, capabilities, actors, layoutWidthHint, laneDisplay } = event.data;
  const laneDisplayOptions: LandscapeLaneDisplayOptions = {
    ...(laneDisplay?.collapsedLaneKeys ? { collapsedLaneKeys: new Set(laneDisplay.collapsedLaneKeys) } : {}),
    ...(laneDisplay?.expandedLaneKeys ? { expandedLaneKeys: new Set(laneDisplay.expandedLaneKeys) } : {}),
    ...(laneDisplay?.pinnedLaneKeys ? { pinnedLaneKeys: laneDisplay.pinnedLaneKeys } : {}),
    ...(laneDisplay?.hiddenLaneKeys ? { hiddenLaneKeys: new Set(laneDisplay.hiddenLaneKeys) } : {}),
  };
  const layout = computeLandscapeLayout(systems, supportsEdges, new Map(capabilities), actors, layoutWidthHint, laneDisplayOptions);
  ctx.postMessage({ requestId, layout });
};
