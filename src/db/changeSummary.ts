/**
 * The change page's own data (Sprint C1 step 6, the user's brief: "summary
 * of deltas grouped by element, affected capabilities via supports, other
 * open changes touching the same elements"). Reuses what's already built
 * rather than inventing new engine machinery: `listOwnDeltas`
 * (src/engine/branch.ts) is exactly "this branch's own deltas, not
 * main's," already used nowhere in production before this; folding the
 * branch's as-is/to-be heads (same as src/db/branchProjection.ts's Sprint
 * C1 step 5 work) gives the current name of every touched subject and the
 * `supports` edges needed to find affected capabilities.
 */
import type { Delta, ElementType, RelationshipType, UUID } from '../contracts/delta';
import { subjectOf } from '../contracts/delta';
import type { ElementsHeadRow } from '../contracts/rows';
import { listOwnDeltas, type BranchFork } from '../engine/branch';
import type { ElementRow, Head } from '../engine/deltas';
import { foldFromGenesis } from '../engine/head';
import { buildCommitLoader } from './commitLoader';
import type { Client } from './client';
import { getSourcesByIds, listInFlightBranchesTouchingSubjects } from './elements';
import type { BranchRow, SourceRow } from './types';

export type ChangeSubject =
  | { subjectType: 'element'; elementType: ElementType }
  | { subjectType: 'relationship'; relationshipType: RelationshipType };

export type ChangeSubjectSummary = ChangeSubject & {
  subjectId: UUID;
  /** The subject's own display name — an element's name, or "`type` A → B" for a relationship — resolved from whichever side (to-be, falling back to as-is for something this branch retracted) still has it. */
  name: string;
  /** This branch's own deltas touching this subject, oldest first (`listOwnDeltas`'s dependency order). */
  deltas: Delta[];
};

export interface AffectedCapability {
  capability: ElementsHeadRow;
  /** Which of this change's own touched systems support it — there can be more than one. */
  viaSystems: ElementsHeadRow[];
}

export interface ChangeSummary {
  /** Empty when the branch has made no commits of its own yet (freshly created, still equal to main). */
  subjects: ChangeSubjectSummary[];
  affectedCapabilities: AffectedCapability[];
  otherOpenChanges: BranchRow[];
  sourcesById: Map<UUID, SourceRow>;
}

function elementRow(elementId: UUID, row: ElementRow): ElementsHeadRow {
  return { element_id: elementId, element_type: row.elementType, name: row.name, parent_id: row.parentId, attributes: row.attributes, exists_delta_id: row.existsDeltaId };
}

function elementName(head: Head, fallbackHead: Head, elementId: UUID): string {
  return (head.elements.get(elementId) ?? fallbackHead.elements.get(elementId))?.name ?? elementId;
}

/** Every `Delta` variant carries its own `elementType`/`relationshipType` (src/contracts/delta.ts) — read directly off the delta rather than a head lookup, so a subject's glyph is right even if it's been retracted from both sides (shouldn't happen, but this doesn't depend on it not happening). */
function subjectTypeOf(delta: Delta): ChangeSubject {
  if ('elementType' in delta) return { subjectType: 'element', elementType: delta.elementType };
  return { subjectType: 'relationship', relationshipType: delta.relationshipType };
}

export interface ChangeSummaryCore {
  subjects: ChangeSubjectSummary[];
  affectedCapabilities: AffectedCapability[];
}

/**
 * The pure half of `loadChangeSummary` — no I/O, so it's unit-testable
 * directly with hand-built `Head`s and a delta list, the same split
 * src/db/branchProjection.ts's `selectBranchModeHead` used for the As-is/
 * To-be/Diff selector's own pure core.
 */
export function summarizeOwnDeltas(ownDeltas: readonly Delta[], asIsHead: Head, toBeHead: Head): ChangeSummaryCore {
  const deltasBySubject = new Map<UUID, ChangeSubject & { deltas: Delta[] }>();
  for (const delta of ownDeltas) {
    const { subjectId } = subjectOf(delta);
    const existing = deltasBySubject.get(subjectId);
    if (existing) existing.deltas.push(delta);
    else deltasBySubject.set(subjectId, { ...subjectTypeOf(delta), deltas: [delta] });
  }

  const subjects: ChangeSubjectSummary[] = [];
  const touchedSystemIds: UUID[] = [];
  const touchedCapabilityIds: UUID[] = [];

  for (const [subjectId, entry] of deltasBySubject) {
    if (entry.subjectType === 'element') {
      const el = toBeHead.elements.get(subjectId) ?? asIsHead.elements.get(subjectId);
      subjects.push({ subjectId, ...entry, name: el?.name ?? subjectId });
      if (el?.elementType === 'system') touchedSystemIds.push(subjectId);
      if (el?.elementType === 'capability') touchedCapabilityIds.push(subjectId);
    } else {
      const rel = toBeHead.relationships.get(subjectId) ?? asIsHead.relationships.get(subjectId);
      const name = rel
        ? `${rel.relationshipType} ${elementName(toBeHead, asIsHead, rel.fromElementId)} → ${elementName(toBeHead, asIsHead, rel.toElementId)}`
        : subjectId;
      subjects.push({ subjectId, ...entry, name });
    }
  }
  subjects.sort((a, b) => a.name.localeCompare(b.name));

  // Affected capabilities (the brief's "via supports"): a touched
  // capability directly, or one a touched system supports — read off the
  // to-be head, since that's this change's own resulting state.
  const systemsByCapabilityId = new Map<UUID, Set<UUID>>();
  for (const capabilityId of touchedCapabilityIds) systemsByCapabilityId.set(capabilityId, new Set());
  for (const rel of toBeHead.relationships.values()) {
    if (rel.relationshipType !== 'supports' || !touchedSystemIds.includes(rel.fromElementId)) continue;
    const systems = systemsByCapabilityId.get(rel.toElementId) ?? new Set<UUID>();
    systems.add(rel.fromElementId);
    systemsByCapabilityId.set(rel.toElementId, systems);
  }
  const affectedCapabilities: AffectedCapability[] = [];
  for (const [capabilityId, systemIds] of systemsByCapabilityId) {
    const capabilityRow = toBeHead.elements.get(capabilityId);
    if (!capabilityRow) continue; // retracted since, or never resolved — no row to show.
    const viaSystems: ElementsHeadRow[] = [];
    for (const systemId of systemIds) {
      const systemRow = toBeHead.elements.get(systemId);
      if (systemRow) viaSystems.push(elementRow(systemId, systemRow));
    }
    affectedCapabilities.push({ capability: elementRow(capabilityId, capabilityRow), viaSystems });
  }
  affectedCapabilities.sort((a, b) => a.capability.name.localeCompare(b.capability.name));

  return { subjects, affectedCapabilities };
}

export async function loadChangeSummary(supabase: Client, modelId: UUID, branch: BranchRow): Promise<ChangeSummary | null> {
  if (!branch.base_commit_id || !branch.head_commit_id) return null;

  const loader = await buildCommitLoader(supabase, modelId);
  const fork: BranchFork = { baseCommitId: branch.base_commit_id, headCommitId: branch.head_commit_id };
  const ownDeltas = listOwnDeltas(fork, loader);

  if (ownDeltas.length === 0) {
    return { subjects: [], affectedCapabilities: [], otherOpenChanges: [], sourcesById: new Map() };
  }

  const toBeHead = foldFromGenesis(branch.head_commit_id, loader);
  const asIsHead = foldFromGenesis(branch.base_commit_id, loader);
  const { subjects, affectedCapabilities } = summarizeOwnDeltas(ownDeltas, asIsHead, toBeHead);

  const subjectIds = subjects.map((s) => s.subjectId);
  const [otherOpenChanges, sourcesById] = await Promise.all([
    listInFlightBranchesTouchingSubjects(supabase, modelId, subjectIds, branch.id),
    getSourcesByIds(supabase, [...new Set(ownDeltas.map((d) => d.sourceId))]),
  ]);

  return { subjects, affectedCapabilities, otherOpenChanges, sourcesById };
}
