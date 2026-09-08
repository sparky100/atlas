/**
 * Data queries for the two front doors (UI-principles §3, Sprint U3b).
 * This sprint's scope is the reduced set the brief names explicitly —
 * counts, changes-in-flight, recent activity, a review-queue count with
 * its oldest item, a capability-map thumbnail with one overall exposure
 * tone — not §3's full interactive health-chip system (per-tile Coverage/
 * Staleness/Confidence/Lifecycle-exposure toggles, the director's branch-
 * scoped to-be zoom) or the architect door's full three-column dashboard
 * (validation status per queue item, "behind main by N commits", mentions
 * floating to the top). Those stay real gaps, not faked — see each
 * component's own comment for exactly what's deferred and why.
 */
import type { UUID } from '../contracts/delta';
import type { CommitRow, ElementsHeadRow, RelationshipsHeadRow } from '../contracts/rows';
import { attributesRecord } from '../ui/elements/attributesRecord';
import type { Client } from './client';
import { selectAll } from './selectAll';

export interface ModelCounts {
  capabilities: number;
  systems: number;
  openChanges: number;
}

/**
 * The director door's three headline counts. `openChanges` counts change
 * branches with a status that means "still in motion" — `draft` through
 * `approved`, matching UI-principles §3.1's "changes in flight" list
 * (`proposed | in_review | approved`) plus `draft` (not yet proposed, but
 * still an open piece of work, not a strange omission from a count that's
 * meant to answer "how much is happening right now").
 */
export async function loadModelCounts(supabase: Client, commitId: UUID, modelId: UUID): Promise<ModelCounts> {
  const [capabilitiesResult, systemsResult, changesResult] = await Promise.all([
    supabase.from('elements_head').select('element_id', { count: 'exact', head: true }).eq('commit_id', commitId).eq('element_type', 'capability'),
    supabase.from('elements_head').select('element_id', { count: 'exact', head: true }).eq('commit_id', commitId).eq('element_type', 'system'),
    supabase.from('branches').select('id', { count: 'exact', head: true }).eq('model_id', modelId).eq('kind', 'change').in('status', ['draft', 'proposed', 'in_review', 'approved']),
  ]);
  if (capabilitiesResult.error) throw new Error(`loadModelCounts: ${capabilitiesResult.error.message}`);
  if (systemsResult.error) throw new Error(`loadModelCounts: ${systemsResult.error.message}`);
  if (changesResult.error) throw new Error(`loadModelCounts: ${changesResult.error.message}`);
  return {
    capabilities: capabilitiesResult.count ?? 0,
    systems: systemsResult.count ?? 0,
    openChanges: changesResult.count ?? 0,
  };
}

/**
 * The most recent commits on `main` (architect door's "recent commits") —
 * newest first, capped at `limit`. A plain `.limit()` query, not
 * `selectAll` (SPEC §6.7's ceiling exists to stop a caller-scoped `.in()`
 * from growing with the model; this is a caller-chosen top-N with its own
 * fixed bound, the same shape `listOpenMergeRequestsForModel` and
 * `listTagsForModel` already use for a bounded "recent things" list).
 */
export async function listRecentCommits(supabase: Client, mainBranchId: UUID, limit = 10): Promise<CommitRow[]> {
  const { data, error } = await supabase.from('commits').select('*').eq('branch_id', mainBranchId).order('created_at', { ascending: false }).limit(limit);
  if (error) throw new Error(`listRecentCommits: ${error.message}`);
  return data as CommitRow[];
}

export type ExposureTone = 'ok' | 'warn';

/**
 * The director door's capability-map thumbnail gets one overall tone, not
 * UI-principles §3.1's full per-tile Lifecycle Exposure chip (which also
 * requires checking every `approved` change branch for a delta-level
 * "planned replacement" — a system added there, supporting the same
 * capability, with the exposed system explicitly retracted in the same
 * branch). This is the honest subset that's actually built this sprint:
 * `warn` the instant any capability has a supporting system whose
 * `lifecycleStatus` is `retiring` or `retired`, full stop — a coarser
 * signal than "and nothing already replaces it", but never a false `ok`
 * (an exposed system with an unrecorded or in-progress replacement still
 * shows `warn`, which is the safe direction to be coarse in).
 */
export function computeExposureTone(supportsEdges: readonly RelationshipsHeadRow[], systemsById: ReadonlyMap<UUID, ElementsHeadRow>): ExposureTone {
  for (const edge of supportsEdges) {
    const system = systemsById.get(edge.from_element_id);
    if (!system) continue;
    const lifecycleStatus = attributesRecord(system.attributes).lifecycleStatus;
    if (lifecycleStatus === 'retiring' || lifecycleStatus === 'retired') return 'warn';
  }
  return 'ok';
}

/** All `supports` edges at `commitId`, regardless of which capability — used once by the thumbnail to compute both the exposure tone and (paired with `capabilities`) the tile list, rather than the per-capability-id `.in()` shape `listSupportsEdgesForCapabilities` needs for the full map view. */
export async function listAllSupportsEdges(supabase: Client, commitId: UUID): Promise<RelationshipsHeadRow[]> {
  const query = supabase
    .from('relationships_head')
    .select('relationship_id, relationship_type, from_element_id, to_element_id, attributes, exists_delta_id', { count: 'exact' })
    .eq('commit_id', commitId)
    .eq('relationship_type', 'supports')
    .order('relationship_id');
  return selectAll<RelationshipsHeadRow>(query);
}
