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
import type { ElementsHeadRow, RelationshipsHeadRow } from '../contracts/rows';
import { listOwnDeltas, type BranchFork } from '../engine/branch';
import { describeEnvelope, type NameLookup } from '../engine/describeEnvelope';
import type { ElementRow, Head, RelationshipRow } from '../engine/deltas';
import { foldFromGenesis } from '../engine/head';
import { compareBySiblingOrder } from '../ui/elements/siblingOrder';
import { type AffectedValueStreamStage, valueStreamsReachedFrom } from '../ui/valueStreams/impactTraversal';
import { moduleDisplayName } from '../ui/elements/moduleDisplayName';
import { findImpactProblems, NO_IMPACT_PROBLEMS, type ImpactProblems } from '../engine/changeImpactProblems';
import { buildCommitLoader } from './commitLoader';
import type { Client } from './client';
import { getSourcesByIds, listOpenChangesSharingElements } from './elements';
import { listProjectLinks } from './projects';
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

/**
 * Why a capability counts as affected (ADR-024's "Amended — change impact").
 * Names are resolved here, from whichever head still has the element, so a
 * caller only formats — `describeImpactReason` (`src/ui/changes/impactFocus.ts`).
 */
export type ImpactReason =
  /** The capability's own record is edited. */
  | { kind: 'direct' }
  /** A system supporting it has its own record edited. */
  | { kind: 'edited'; systemName: string }
  /** One of a supporting system's modules is edited — a module rolls up to its platform. */
  | { kind: 'module'; systemName: string; moduleName: string }
  /** A `uses`/`flows_to` edge is added, changed or removed with a supporting system (or one of its modules) on the consuming `from` side. The provider (`to`) side is never counted: gaining a consumer doesn't change how it delivers its own capabilities. */
  | { kind: 'integration'; systemName: string; consumerName: string; relationshipType: 'uses' | 'flows_to'; otherName: string }
  /** The `supports` edge to this capability is itself added, changed or removed. */
  | { kind: 'supports'; systemName: string };

export interface AffectedCapability {
  capability: ElementsHeadRow;
  /** Which of this change's own touched systems support it — there can be more than one. */
  viaSystems: ElementsHeadRow[];
  /** Every reason it counts, in the order this change's own subjects were first touched — never empty. */
  reasons: ImpactReason[];
}

/** Whether something this change names directly is new, gone, or still there but changed — read from which head has it. */
export type ImpactChange = 'added' | 'edited' | 'removed';

/** Why a stage or stream counts as affected directly (ADR-023's "Amended — change impact"), beside being reached through an affected capability (`viaCapabilities`). */
export type ValueStreamReason =
  | { kind: 'stage'; change: ImpactChange }
  | { kind: 'stream'; change: ImpactChange }
  /** A capability → stage `enables` edge added, changed or removed. */
  | { kind: 'enables'; capabilityName: string; change: ImpactChange };

export interface ChangeValueStreamStage extends AffectedValueStreamStage {
  /** Direct reasons only — empty when the stage is reached through `viaCapabilities` alone. */
  reasons: ValueStreamReason[];
}

/** `AffectedValueStream` with the change's own direct reasons — still assignable to it, so every reader of the plain traversal shape keeps working. */
export interface ChangeAffectedValueStream {
  stream: ElementsHeadRow;
  stages: ChangeValueStreamStage[];
  /** The stream's own record added, edited or removed by this change. */
  reasons: ValueStreamReason[];
}

export interface ChangeSummary {
  /** Empty when the branch has made no commits of its own yet (freshly created, still equal to main). */
  subjects: ChangeSubjectSummary[];
  affectedCapabilities: AffectedCapability[];
  /** F6 (ADR-023): every stage/stream an affected capability enables, plus (ADR-023's "Amended — change impact") any this change edits directly or reaches through its own `enables` edges. */
  affectedValueStreams: ChangeAffectedValueStream[];
  /** Problems this change causes that the lists above don't show: capabilities left with no system, and provider-side dependencies that are ending or removed. Empty when there are none. */
  impactProblems: ImpactProblems;
  /** Other open changes sharing an element with this one (ADR-024 §9), with the shared elements' display names ("Platform · Module" for a module). */
  otherOpenChanges: { branch: BranchRow; sharedElementNames: string[] }[];
  /** Unreviewed capture drafts (`kind: 'capture_draft'`) sharing an element with this change — kept apart from real changes (ADR-024 §9), one entry per source document however many times it was uploaded. */
  captureDraftOverlaps: CaptureDraftOverlap[];
  sourcesById: Map<UUID, SourceRow>;
  /** The element ids in the change's own project's declared scope, or `null` when the change belongs to no project — what `focusImpact` narrows the shown list by. */
  projectScopeIds: ReadonlySet<UUID> | null;
}

function elementRow(elementId: UUID, row: ElementRow): ElementsHeadRow {
  return { element_id: elementId, element_type: row.elementType, name: row.name, parent_id: row.parentId, attributes: row.attributes, exists_delta_id: row.existsDeltaId };
}

function relationshipRow(relationshipId: UUID, row: RelationshipRow): RelationshipsHeadRow {
  return { relationship_id: relationshipId, relationship_type: row.relationshipType, from_element_id: row.fromElementId, to_element_id: row.toElementId, attributes: row.attributes, exists_delta_id: row.existsDeltaId };
}

function elementName(head: Head, fallbackHead: Head, elementId: UUID): string {
  return (head.elements.get(elementId) ?? fallbackHead.elements.get(elementId))?.name ?? elementId;
}

/** Every `Delta` variant carries its own `elementType`/`relationshipType` (src/contracts/delta.ts) — read directly off the delta rather than a head lookup, so a subject's glyph is right even if it's been retracted from both sides (shouldn't happen, but this doesn't depend on it not happening). */
function subjectTypeOf(delta: Delta): ChangeSubject {
  if ('elementType' in delta) return { subjectType: 'element', elementType: delta.elementType };
  return { subjectType: 'relationship', relationshipType: delta.relationshipType };
}

/** One source document's capture drafts that overlap a change — grouped, since uploading the same document again makes another draft. */
export interface CaptureDraftOverlap {
  /** The drafts' shared title ("file — date"). */
  title: string;
  draftCount: number;
  /** The newest draft's capture job — what "Review" opens. `null` if no job row names the draft (shouldn't happen; the row is still listed). */
  latestJobId: UUID | null;
  sharedElementNames: string[];
}

/**
 * Groups overlapping capture drafts by title (ADR-024 §9): `latestJobId` is
 * the group's newest capture job, shared element names are unioned, groups
 * sorted by title.
 */
export function groupCaptureDraftOverlaps(drafts: readonly { branch: BranchRow; sharedElementNames: string[] }[], jobByBranchId: ReadonlyMap<UUID, { id: UUID; createdAt: string }>): CaptureDraftOverlap[] {
  const groups = new Map<string, { drafts: BranchRow[]; names: Set<string> }>();
  for (const { branch, sharedElementNames } of drafts) {
    const title = branch.title ?? branch.name;
    const group = groups.get(title) ?? { drafts: [], names: new Set<string>() };
    group.drafts.push(branch);
    for (const name of sharedElementNames) group.names.add(name);
    groups.set(title, group);
  }
  return [...groups.entries()]
    .map(([title, group]) => {
      const jobs = group.drafts.map((d) => jobByBranchId.get(d.id)).filter((job): job is { id: UUID; createdAt: string } => job !== undefined);
      const newest = jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))[0];
      return { title, draftCount: group.drafts.length, latestJobId: newest?.id ?? null, sharedElementNames: [...group.names].sort((a, b) => a.localeCompare(b)) };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

export interface ChangeSummaryCore {
  subjects: ChangeSubjectSummary[];
  affectedCapabilities: AffectedCapability[];
  affectedValueStreams: ChangeAffectedValueStream[];
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
  /** A touched system's or module's own id -> the reasons it counts as touched, in first-touched order. A touched module is recorded under both its own id and its platform's, so a `supports` edge from either reaches its capability. */
  const reasonsByElementId = new Map<UUID, ImpactReason[]>();
  /** capabilityId -> reasons that name it directly (its own edit, or its own `supports` edge). */
  const directReasonsByCapabilityId = new Map<UUID, { reasons: ImpactReason[]; systemIds: Set<UUID> }>();
  const element = (id: UUID) => toBeHead.elements.get(id) ?? asIsHead.elements.get(id);
  const addTouchedReason = (elementId: UUID, systemId: UUID, reason: ImpactReason) => {
    for (const id of new Set([elementId, systemId])) {
      const reasons = reasonsByElementId.get(id) ?? [];
      reasons.push(reason);
      reasonsByElementId.set(id, reasons);
    }
  };
  const addCapabilityReason = (capabilityId: UUID, reason: ImpactReason, systemId: UUID | null) => {
    const entry = directReasonsByCapabilityId.get(capabilityId) ?? { reasons: [], systemIds: new Set<UUID>() };
    entry.reasons.push(reason);
    if (systemId !== null) entry.systemIds.add(systemId);
    directReasonsByCapabilityId.set(capabilityId, entry);
  };
  /** The system an element stands for in impact terms — itself, or a module's own parent system — with the element's own display name ("Platform · Module" for a module). */
  const owningSystem = (elementId: UUID): { systemId: UUID; system: ElementRow; displayName: string } | null => {
    const el = element(elementId);
    // system-only: a system is its own owning system; the next branch resolves a module to its platform.
    if (el?.elementType === 'system') return { systemId: elementId, system: el, displayName: el.name };
    if (el?.elementType === 'container' && el.parentId !== null) {
      const parent = element(el.parentId);
      // system-only: a module's parent must be a platform system.
      if (parent?.elementType !== 'system') return null;
      return { systemId: el.parentId, system: parent, displayName: moduleDisplayName(elementRow(elementId, el), elementRow(el.parentId, parent)) };
    }
    return null;
  };

  /** An element's name as the rest of the product shows it: a module reads "Platform · Module" (`moduleDisplayName`), everything else is its own name — an id only for something neither head knows. */
  const displayNameOf = (elementId: UUID): string => owningSystem(elementId)?.displayName ?? elementName(toBeHead, asIsHead, elementId);

  for (const [subjectId, entry] of deltasBySubject) {
    if (entry.subjectType === 'element') {
      const el = element(subjectId);
      // An element created and retracted on this same change is in neither head — its own create delta still names it.
      const created = entry.deltas.find((d) => d.kind === 'element.create');
      const ownName = created?.kind === 'element.create' ? created.name : null;
      subjects.push({ subjectId, ...entry, name: el ? displayNameOf(subjectId) : (ownName ?? 'An element that no longer exists') });
      // system-only: a module is handled in its own branch just below, with the platform it sits in.
      if (el?.elementType === 'system') addTouchedReason(subjectId, subjectId, { kind: 'edited', systemName: el.name });
      if (el?.elementType === 'capability') addCapabilityReason(subjectId, { kind: 'direct' }, null);
      if (el?.elementType === 'container') {
        const owner = owningSystem(subjectId);
        if (owner) addTouchedReason(subjectId, owner.systemId, { kind: 'module', systemName: owner.system.name, moduleName: owner.displayName });
      }
    } else {
      const rel = toBeHead.relationships.get(subjectId) ?? asIsHead.relationships.get(subjectId);
      // A relationship created and retracted on this same change is in
      // neither head — its own create delta still names both ends.
      const created = entry.deltas.find((d) => d.kind === 'relationship.create');
      const ends = rel ?? (created?.kind === 'relationship.create' ? created : null);
      const name = ends
        ? `${ends.relationshipType} ${displayNameOf(ends.fromElementId)} → ${displayNameOf(ends.toElementId)}`
        : subjectId;
      subjects.push({ subjectId, ...entry, name });
      if (rel && (rel.relationshipType === 'uses' || rel.relationshipType === 'flows_to')) {
        const consumer = owningSystem(rel.fromElementId);
        if (consumer) {
          const other = owningSystem(rel.toElementId);
          addTouchedReason(rel.fromElementId, consumer.systemId, {
            kind: 'integration',
            systemName: consumer.system.name,
            consumerName: consumer.displayName,
            relationshipType: rel.relationshipType,
            otherName: other?.displayName ?? elementName(toBeHead, asIsHead, rel.toElementId),
          });
        }
      }
      if (rel?.relationshipType === 'supports') {
        const supporter = owningSystem(rel.fromElementId);
        addCapabilityReason(rel.toElementId, { kind: 'supports', systemName: supporter?.displayName ?? elementName(toBeHead, asIsHead, rel.fromElementId) }, supporter ? rel.fromElementId : null);
      }
    }
  }
  subjects.sort((a, b) => a.name.localeCompare(b.name));

  // Affected capabilities (ADR-024's "Amended — change impact"): a capability
  // named directly (its own edit or its own `supports` edge), or one a
  // touched system or module supports — "touched" meaning its own record,
  // one of its modules, or the consuming side of an integration changed; a
  // module's own `supports` edges count as well as its platform's. Read off the
  // to-be head, since that's this change's own resulting state.
  const byCapabilityId = new Map<UUID, { reasons: ImpactReason[]; systemIds: Set<UUID> }>();
  for (const [capabilityId, entry] of directReasonsByCapabilityId) byCapabilityId.set(capabilityId, { reasons: [...entry.reasons], systemIds: new Set(entry.systemIds) });
  for (const rel of toBeHead.relationships.values()) {
    if (rel.relationshipType !== 'supports') continue;
    const systemReasons = reasonsByElementId.get(rel.fromElementId);
    if (!systemReasons) continue;
    const entry = byCapabilityId.get(rel.toElementId) ?? { reasons: [], systemIds: new Set<UUID>() };
    entry.reasons.push(...systemReasons);
    entry.systemIds.add(rel.fromElementId);
    byCapabilityId.set(rel.toElementId, entry);
  }
  const affectedCapabilities: AffectedCapability[] = [];
  for (const [capabilityId, { reasons, systemIds }] of byCapabilityId) {
    const capabilityRow = toBeHead.elements.get(capabilityId);
    if (capabilityRow?.elementType !== 'capability') continue; // retracted since, never resolved, or not a capability — no row to show.
    const viaSystems: ElementsHeadRow[] = [];
    for (const systemId of systemIds) {
      const systemRow = toBeHead.elements.get(systemId);
      if (systemRow) viaSystems.push(elementRow(systemId, systemRow));
    }
    affectedCapabilities.push({ capability: elementRow(capabilityId, capabilityRow), viaSystems, reasons });
  }
  affectedCapabilities.sort((a, b) => a.capability.name.localeCompare(b.capability.name));

  // F6 (ADR-023): the one more hop, over the to-be head — an affected
  // capability (direct or via-system, above) reaching a stage it enables,
  // grouped by the stage's own stream. `elementsById`/`enablesEdges` are
  // built from the same `toBeHead` this function already reads throughout,
  // not a second fetch.
  const elementsById = new Map<UUID, ElementsHeadRow>();
  for (const [id, row] of toBeHead.elements) elementsById.set(id, elementRow(id, row));
  const enablesEdges: RelationshipsHeadRow[] = [];
  for (const [id, row] of toBeHead.relationships) {
    if (row.relationshipType === 'enables') enablesEdges.push(relationshipRow(id, row));
  }
  const reached = valueStreamsReachedFrom(
    affectedCapabilities.map((ac) => ac.capability.element_id),
    elementsById,
    enablesEdges,
  );

  // ADR-023's "Amended — change impact": a stage or stream this change edits
  // itself, or whose `enables` edge it adds, changes or removes, counts
  // directly — not only when an affected capability reaches it. A removed
  // stage or edge is read from the as-is head.
  const streams = new Map<UUID, { stream: ElementsHeadRow; stages: Map<UUID, ChangeValueStreamStage>; reasons: ValueStreamReason[] }>();
  for (const { stream, stages } of reached) {
    streams.set(stream.element_id, { stream, reasons: [], stages: new Map(stages.map((st) => [st.stage.element_id, { ...st, reasons: [] }])) });
  }
  const anyRow = (id: UUID): ElementsHeadRow | null => {
    const row = element(id);
    return row ? elementRow(id, row) : null;
  };
  const changeOf = (inToBe: boolean, inAsIs: boolean): ImpactChange => (inToBe && !inAsIs ? 'added' : !inToBe && inAsIs ? 'removed' : 'edited');
  const streamEntry = (streamId: UUID) => {
    const existing = streams.get(streamId);
    if (existing) return existing;
    const stream = anyRow(streamId);
    if (stream?.element_type !== 'value_stream') return null;
    const created = { stream, reasons: [] as ValueStreamReason[], stages: new Map<UUID, ChangeValueStreamStage>() };
    streams.set(streamId, created);
    return created;
  };
  const addStageReason = (stageId: UUID, reason: ValueStreamReason) => {
    const stage = anyRow(stageId);
    if (stage?.element_type !== 'value_stream' || stage.parent_id === null) return;
    const entry = streamEntry(stage.parent_id);
    if (!entry) return;
    const stageEntry = entry.stages.get(stageId) ?? { stage, viaCapabilities: [], reasons: [] };
    stageEntry.reasons.push(reason);
    entry.stages.set(stageId, stageEntry);
  };
  for (const [subjectId, entry] of deltasBySubject) {
    if (entry.subjectType === 'element' && entry.elementType === 'value_stream') {
      const row = element(subjectId);
      const change = changeOf(toBeHead.elements.has(subjectId), asIsHead.elements.has(subjectId));
      if (!row) continue;
      if (row.parentId !== null) addStageReason(subjectId, { kind: 'stage', change });
      else streamEntry(subjectId)?.reasons.push({ kind: 'stream', change });
    } else if (entry.subjectType === 'relationship' && entry.relationshipType === 'enables') {
      const rel = toBeHead.relationships.get(subjectId) ?? asIsHead.relationships.get(subjectId);
      if (!rel) continue; // created and removed again on this change — no net effect.
      const change = changeOf(toBeHead.relationships.has(subjectId), asIsHead.relationships.has(subjectId));
      addStageReason(rel.toElementId, { kind: 'enables', capabilityName: elementName(toBeHead, asIsHead, rel.fromElementId), change });
    }
  }
  const affectedValueStreams: ChangeAffectedValueStream[] = [...streams.values()]
    .map(({ stream, stages, reasons }) => ({ stream, reasons, stages: [...stages.values()].sort((a, b) => compareBySiblingOrder(a.stage, b.stage)) }))
    .sort((a, b) => a.stream.name.localeCompare(b.stream.name));

  return { subjects, affectedCapabilities, affectedValueStreams };
}

/** Each capture draft branch's own job (`capture_jobs.resulting_branch_id`) — the model's jobs read whole and narrowed in memory (CLAUDE.md rule 8). */
async function loadCaptureJobsByBranch(supabase: Client, modelId: UUID): Promise<Map<UUID, { id: UUID; createdAt: string }>> {
  const { data, error } = await supabase.from('capture_jobs').select('id, resulting_branch_id, created_at').eq('model_id', modelId).not('resulting_branch_id', 'is', null);
  if (error) throw new Error(`loadCaptureJobsByBranch: ${error.message}`);
  return new Map((data as { id: UUID; resulting_branch_id: UUID; created_at: string }[]).map((row) => [row.resulting_branch_id, { id: row.id, createdAt: row.created_at }]));
}

/** The element ids in a project's declared scope (ADR-024 `project_links`, `linked_type: 'element'`), or `null` for a change in no project. */
async function loadProjectScopeIds(supabase: Client, projectId: UUID | null): Promise<ReadonlySet<UUID> | null> {
  if (projectId === null) return null;
  const links = await listProjectLinks(supabase, projectId);
  return new Set(links.filter((l) => l.linked_type === 'element').map((l) => l.linked_id));
}

export async function loadChangeSummary(supabase: Client, modelId: UUID, branch: BranchRow): Promise<ChangeSummary | null> {
  if (!branch.base_commit_id || !branch.head_commit_id) return null;

  const loader = await buildCommitLoader(supabase, modelId);
  const fork: BranchFork = { baseCommitId: branch.base_commit_id, headCommitId: branch.head_commit_id };
  const ownDeltas = listOwnDeltas(fork, loader);

  if (ownDeltas.length === 0) {
    return { subjects: [], affectedCapabilities: [], affectedValueStreams: [], impactProblems: NO_IMPACT_PROBLEMS, otherOpenChanges: [], captureDraftOverlaps: [], sourcesById: new Map(), projectScopeIds: null };
  }

  const toBeHead = foldFromGenesis(branch.head_commit_id, loader);
  const asIsHead = foldFromGenesis(branch.base_commit_id, loader);
  const { subjects, affectedCapabilities, affectedValueStreams } = summarizeOwnDeltas(ownDeltas, asIsHead, toBeHead);
  const impactProblems = findImpactProblems(ownDeltas, asIsHead, toBeHead, new Date());

  const element = (id: UUID) => toBeHead.elements.get(id) ?? asIsHead.elements.get(id);
  const parentOf = (id: UUID) => {
    const el = element(id);
    return el?.elementType === 'container' ? el.parentId : null;
  };
  const [overlaps, sourcesById, projectScopeIds] = await Promise.all([
    listOpenChangesSharingElements(supabase, modelId, branch.id, touchedElementIds(ownDeltas, asIsHead, toBeHead), parentOf),
    getSourcesByIds(supabase, [...new Set(ownDeltas.map((d) => d.sourceId))]),
    loadProjectScopeIds(supabase, branch.project_id),
  ]);

  const named = overlaps.map(({ branch: other, sharedElementIds }) => ({
    branch: other,
    sharedElementNames: sharedElementIds.map((id) => {
      const el = element(id);
      if (!el) return 'an element not on this change';
      const parent = el.elementType === 'container' && el.parentId !== null ? element(el.parentId) : undefined;
      return moduleDisplayName(elementRow(id, el), parent && el.parentId !== null ? elementRow(el.parentId, parent) : null);
    }),
  }));
  // ADR-024 §9: an unreviewed capture draft isn't a change — it's listed
  // apart, grouped by document (each re-upload makes another draft).
  const otherOpenChanges = named.filter((o) => o.branch.kind !== 'capture_draft');
  const drafts = named.filter((o) => o.branch.kind === 'capture_draft');
  const captureDraftOverlaps = drafts.length === 0 ? [] : groupCaptureDraftOverlaps(drafts, await loadCaptureJobsByBranch(supabase, modelId));

  return { subjects, affectedCapabilities, affectedValueStreams, impactProblems, otherOpenChanges, captureDraftOverlaps, sourcesById, projectScopeIds };
}

/**
 * Every element a change's own deltas touch (ADR-024 §9): each element it
 * edits, and both ends of each relationship it adds, changes or removes —
 * read from either head, or from the change's own create delta for a
 * relationship it created and removed again.
 */
export function touchedElementIds(ownDeltas: readonly Delta[], asIsHead: Head, toBeHead: Head): Set<UUID> {
  const touched = new Set<UUID>();
  for (const delta of ownDeltas) {
    const { subjectType, subjectId } = subjectOf(delta);
    if (subjectType === 'element') {
      touched.add(subjectId);
      continue;
    }
    const rel = toBeHead.relationships.get(subjectId) ?? asIsHead.relationships.get(subjectId) ?? (delta.kind === 'relationship.create' ? delta : undefined);
    if (rel) {
      touched.add(rel.fromElementId);
      touched.add(rel.toElementId);
    }
  }
  return touched;
}

export interface ChangeListSummary extends ChangeSummaryCore {
  /**
   * Sprint 7i item 3's "one-line 'what this change does' from
   * describeEnvelope" — over the branch's *entire* accumulated own-delta
   * set (`listOwnDeltas`'s real chronological order), not one commit's
   * worth the way `commits.title` itself is computed. `describeEnvelope`
   * only ever looks at `deltas[0]` plus a count (its own doc comment), so
   * this reads as "the first thing this change did (+N more)" — an honest
   * gist, not a full summary.
   */
  description: string;
  /** Same as `ChangeSummary.projectScopeIds`. */
  projectScopeIds: ReadonlySet<UUID> | null;
}

/**
 * Sprint 7i item 3's list-card data — "affected capabilities" and the
 * describeEnvelope one-liner, for every branch on the Changes list at
 * once. Shares exactly one `buildCommitLoader` call across every branch
 * (it loads the whole model's commits/deltas up front by design — that
 * module's own comment) rather than `loadChangeSummary`'s one-loader-per-
 * branch shape, which would rebuild it once per card; batch, not N+1, per
 * the Working rules' own "batch, don't enumerate" instinct.
 */
export async function loadChangeSummariesForModel(supabase: Client, modelId: UUID, branches: readonly BranchRow[]): Promise<Map<UUID, ChangeListSummary>> {
  const result = new Map<UUID, ChangeListSummary>();
  if (branches.length === 0) return result;

  // One `project_links` read per distinct project among these branches — a
  // handful at most, never one per branch.
  const projectIds = [...new Set(branches.map((b) => b.project_id).filter((id): id is UUID => id !== null))];
  const [loader, scopes] = await Promise.all([buildCommitLoader(supabase, modelId), Promise.all(projectIds.map((id) => loadProjectScopeIds(supabase, id)))]);
  const scopeByProjectId = new Map(projectIds.map((id, i) => [id, scopes[i] ?? null]));
  for (const branch of branches) {
    const projectScopeIds = branch.project_id !== null ? (scopeByProjectId.get(branch.project_id) ?? null) : null;
    // ADR-018 guarantees both are real in practice; BranchRow's own type
    // hasn't been narrowed yet (same gap every other reader of these two
    // columns still carries, per LandscapePage.tsx's own comment) — skipped
    // rather than thrown on, since one malformed row shouldn't blank the
    // whole list.
    if (!branch.base_commit_id || !branch.head_commit_id) continue;

    const fork: BranchFork = { baseCommitId: branch.base_commit_id, headCommitId: branch.head_commit_id };
    const ownDeltas = listOwnDeltas(fork, loader);
    if (ownDeltas.length === 0) {
      result.set(branch.id, { subjects: [], affectedCapabilities: [], affectedValueStreams: [], description: 'No changes yet', projectScopeIds });
      continue;
    }

    // Same "one bad row shouldn't blank the whole list" stance as the
    // null-commit-id skip above, extended to the fold itself: a branch
    // whose own history can't be replayed (a pre-existing structural
    // violation from before a gate like V6 existed, most often — a real
    // production case, `useChangeSummaries.ts`'s own doc comment already
    // promised this degrades one card, not the whole batch) is skipped
    // here rather than left to throw and take every other branch's
    // summary down with it, cancelled or not.
    try {
      const toBeHead = foldFromGenesis(branch.head_commit_id, loader);
      const asIsHead = foldFromGenesis(branch.base_commit_id, loader);
      const { subjects, affectedCapabilities, affectedValueStreams } = summarizeOwnDeltas(ownDeltas, asIsHead, toBeHead);
      // Every element in either head, not just this branch's own touched
      // subjects — a `relationship.create` delta's endpoint is frequently a
      // pre-existing element nothing else on this branch touched, and
      // `describeEnvelope`'s own doc comment is explicit that an unresolved
      // id falls back to "(unknown)" rather than guessing.
      const nameLookup: NameLookup = (id) => toBeHead.elements.get(id)?.name ?? asIsHead.elements.get(id)?.name;
      const description = describeEnvelope(ownDeltas, nameLookup);
      result.set(branch.id, { subjects, affectedCapabilities, affectedValueStreams, description, projectScopeIds });
    } catch {
      continue;
    }
  }
  return result;
}
