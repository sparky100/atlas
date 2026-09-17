/**
 * The pure data-shaping half of `ContextInspectorContent.tsx`'s Selection
 * section — split into its own file for the same two reasons
 * `src/ui/landscape/landscapeInspectorSelection.ts` already gives:
 * independently unit-testable, and doesn't trip
 * `react-refresh/only-export-components`.
 *
 * Unlike Landscape/Capability map (raw edges + a by-id map, filtered
 * here), `useElementContext.ts` already hands `ContextView`/`ContextPage`
 * a fully-grouped `ContextGroup` — each neighbour already carries its own
 * resolved `edges`. So this file's only real job is finding *which*
 * neighbour a focused id refers to; `edgeLabel` (already exported by
 * `contextGrouping.ts`) is reused as-is for that neighbour's own
 * Connections content, not reimplemented here.
 */
import type { UUID } from '../../contracts/delta';
import type { ContextGroup, ContextNeighbour } from './contextGrouping';

/** The focused neighbour (internal or external) named by `focusedElementId`, or `null` when nothing's focused, the id doesn't name a neighbour of this hub, or (a fresh page load, a reload after an edit) the neighbour it used to name is simply gone. Never the hub itself — `ContextDiagramCanvasProps`'s own `focusedElementId` doc comment explains why the hub never enters focus at all. */
export function contextInspectorFocusedNeighbour(focusedElementId: UUID | null, group: ContextGroup): ContextNeighbour | null {
  if (focusedElementId === null) return null;
  return [...group.internal, ...group.external].find((n) => n.element.element_id === focusedElementId) ?? null;
}
