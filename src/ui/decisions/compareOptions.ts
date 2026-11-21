import { loadHeadAtCommitCached } from '../query/cachedBranchProjection';
import type { Client } from '../../db/client';
import type { CompareDecisionOptionsInput, CompareDecisionOptionsResult } from '../../engine/decisionDigest/compareOptions';
import { compareDecisionOptions as compareShared } from '../../engine/decisionDigest/compareOptions';
export * from '../../engine/decisionDigest/compareOptions';
export function compareDecisionOptions(supabase: Client, input: CompareDecisionOptionsInput): Promise<CompareDecisionOptionsResult> {
  return compareShared(supabase, input, (id) => loadHeadAtCommitCached(supabase, input.modelId, id));
}
