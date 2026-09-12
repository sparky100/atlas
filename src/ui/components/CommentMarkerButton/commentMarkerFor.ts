import type { UUID } from '../../../contracts/delta';
import type { CommentMarkerState } from './CommentMarkerButton';

/**
 * The same "ink if any thread is open, hollow if every thread is resolved,
 * omitted entirely with no thread at all" rule `LandscapeCanvas.tsx`'s own
 * `drawNode` already applies per node — one shared derivation so
 * `LandscapeMobileList.tsx`/`CapabilityLandscapeList.tsx` (S1 item 12)
 * don't each reimplement it slightly differently.
 */
export function commentMarkerFor(elementId: UUID, threadCounts: ReadonlyMap<UUID, { open: number; total: number }> | undefined): CommentMarkerState | undefined {
  const counts = threadCounts?.get(elementId);
  if (!counts || counts.total === 0) return undefined;
  return counts.open > 0 ? { state: 'ink', count: counts.open } : { state: 'hollow' };
}
