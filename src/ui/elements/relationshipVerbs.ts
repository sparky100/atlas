/**
 * Present-tense outbound/inbound phrasing for a relationship, shared by
 * every "what does this edge mean, in plain English" list —
 * `RemoveFromModelAction.tsx`'s own list of what a retract cascades into,
 * and `mergeEffectSentences.ts`'s own preview of what a merge re-points
 * (E7). Extracted here rather than duplicated so both stay in sync.
 */
import type { RelationshipType } from '../../contracts/delta';

export const OUTBOUND_VERB: Record<RelationshipType, string> = {
  supports: 'supports',
  owns: 'owns',
  uses: 'uses',
  flows_to: 'flows to',
  replaces: 'replaces',
  enables: 'enables',
};

export const INBOUND_VERB: Record<RelationshipType, string> = {
  supports: 'supported by',
  owns: 'owned by',
  uses: 'used by',
  flows_to: 'receives from',
  replaces: 'replaced by',
  enables: 'enabled by',
};
