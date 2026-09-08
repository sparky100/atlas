/**
 * The architect door's Health findings (Handoff 7d's architect-door
 * amendment, `docs/HANDOFF-7d-architect-door.md` — UI-principles §3.2's
 * own "below the fold" health chips, built here as the first real step
 * toward that fuller dashboard, not the whole of it). Three genuinely new
 * findings — systems with no capability, capabilities with no owner,
 * attributes stale past `STALE_AFTER_MONTHS` — plus the duplicates count
 * `useArchitectHome.ts` already wires to 0 until Q1 (ADR-019).
 *
 * "Owner" here is a derived concept, not a direct column: capabilities
 * have no `owner` attribute of their own (`CAPABILITY_ORDER` is `code`/
 * `description`/`templateRef` only), and `owns` relationships only ever
 * point at a *system* (`relationshipTypeRules.ts`), never a capability
 * directly. A capability counts as owned when at least one of its
 * supporting systems has a `primary: true` `owns` relationship pointing
 * at it — the same roll-up-through-`supports` shape
 * `computeExposureTone` (`src/db/modelHome.ts`) already uses for
 * lifecycle exposure, applied to ownership instead of lifecycle status.
 */
import { isStale, monthsSince, STALE_AFTER_MONTHS } from '../contracts/thresholds';
import type { ElementsHeadRow, FactsRow, RelationshipsHeadRow } from '../contracts/rows';
import type { UUID } from '../contracts/delta';
import { attributesRecord } from '../ui/elements/attributesRecord';
import type { Client } from './client';
import { selectAll } from './selectAll';

/** All `owns` edges at `commitId` — the ownership-rollup half of the health findings, same shape as `listAllSupportsEdges` (`src/db/modelHome.ts`) for the exposure-rollup half. */
export async function listAllOwnsEdges(supabase: Client, commitId: string): Promise<RelationshipsHeadRow[]> {
  const query = supabase
    .from('relationships_head')
    .select('relationship_id, relationship_type, from_element_id, to_element_id, attributes, exists_delta_id', { count: 'exact' })
    .eq('commit_id', commitId)
    .eq('relationship_type', 'owns')
    .order('relationship_id');
  return selectAll<RelationshipsHeadRow>(query);
}

/** Every fact at `commitId`, unfiltered by subject — callers scope to the systems they care about (health findings only reads systems' own attributes, not every subject in the model). Routed through `selectAll` (SPEC §6.7): `facts` is one of the tables `max_rows` can silently truncate. */
export async function listFactsForCommit(supabase: Client, commitId: string): Promise<FactsRow[]> {
  const query = supabase.from('facts').select('*', { count: 'exact' }).eq('commit_id', commitId).order('subject_id').order('attribute');
  return selectAll<FactsRow>(query);
}

/** Systems with no `supports` edge into any capability at all — Handoff 7d's "systems not linked to a capability" finding. */
export function findSystemsWithoutCapability(systems: readonly ElementsHeadRow[], supportsEdges: readonly RelationshipsHeadRow[]): ElementsHeadRow[] {
  const linkedSystemIds = new Set(supportsEdges.map((edge) => edge.from_element_id));
  return systems.filter((system) => !linkedSystemIds.has(system.element_id));
}

/** Capabilities with no supporting system that has a `primary: true` `owns` relationship pointing at it — see this module's own comment on why "owner" has to be derived through `supports`, not read off a column. */
export function findCapabilitiesWithoutOwner(
  capabilities: readonly ElementsHeadRow[],
  supportsEdges: readonly RelationshipsHeadRow[],
  ownsEdges: readonly RelationshipsHeadRow[],
): ElementsHeadRow[] {
  const primaryOwnedSystemIds = new Set(ownsEdges.filter((edge) => attributesRecord(edge.attributes).primary === true).map((edge) => edge.to_element_id));
  const ownedCapabilityIds = new Set(supportsEdges.filter((edge) => primaryOwnedSystemIds.has(edge.from_element_id)).map((edge) => edge.to_element_id));
  return capabilities.filter((capability) => !ownedCapabilityIds.has(capability.element_id));
}

export interface StaleAttributesFinding {
  /** Distinct (system, attribute) facts older than `STALE_AFTER_MONTHS`. */
  staleFactCount: number;
  /** Distinct systems with at least one stale fact. */
  systemCount: number;
  /** The single oldest stale fact's age in whole years — `null` when `staleFactCount` is 0. */
  oldestAgeYears: number | null;
}

/** Handoff 7d's "N attributes stale over 12 months — across M systems · oldest Ky" finding, scoped to `systemIds`' own facts (not every subject in the model — capabilities/actors/relationships aren't this finding's concern). */
export function computeStaleAttributesFinding(facts: readonly FactsRow[], systemIds: ReadonlySet<UUID>, now: Date = new Date()): StaleAttributesFinding {
  let staleFactCount = 0;
  let oldestMonths = 0;
  const staleSystemIds = new Set<UUID>();

  for (const fact of facts) {
    if (!systemIds.has(fact.subject_id)) continue;
    const dateStr = fact.effective_date ?? fact.asserted_at;
    const date = new Date(dateStr);
    if (!isStale(date, now)) continue;
    staleFactCount += 1;
    staleSystemIds.add(fact.subject_id);
    const months = monthsSince(date, now);
    if (months > oldestMonths) oldestMonths = months;
  }

  return { staleFactCount, systemCount: staleSystemIds.size, oldestAgeYears: staleFactCount > 0 ? Math.floor(oldestMonths / 12) : null };
}

export { STALE_AFTER_MONTHS };
