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

/** The focused neighbour (internal or external) named by `focusedElementId`, or `null` when nothing's focused, the id names the hub itself, or (a fresh page load, a reload after an edit) the neighbour it used to name is simply gone. Always `null` for the hub's own id — a click on the hub tile still navigates rather than focusing it (`ContextDiagramCanvasProps`'s own `focusedElementId` doc comment) — `ContextInspectorContent.tsx`'s own caller treats every `null` result here as "show the hub instead" (V2 item 5), not as "show nothing". */
export function contextInspectorFocusedNeighbour(focusedElementId: UUID | null, group: ContextGroup): ContextNeighbour | null {
  if (focusedElementId === null) return null;
  return [...group.internal, ...group.external].find((n) => n.element.element_id === focusedElementId) ?? null;
}
