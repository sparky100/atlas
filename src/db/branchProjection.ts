/**
 * In-memory equivalents of src/db/elements.ts's, src/db/landscape.ts's, and
 * src/db/structureView.ts's queries — same filtering, same result shape
 * (`ElementsHeadRow`/`RelationshipsHeadRow`), but over a `HeadProjection`
 * already folded in memory (src/engine/projection.ts's
 * `serializeHeadProjection`) instead of a `SELECT ... WHERE commit_id = ?`.
 *
 * Every one of those SQL queries reads `elements_head`/`relationships_head`,
 * which SPEC §1 S-2 only ever materialises for `main`'s current head and
 * tags — never a `change` branch's head, at any point in its life. Sprint
 * C1's As-is/To-be/Diff selector is the first time this product needs to
 * render a *branch's* content on the landscape/context/container/component
 * canvases (landscape.ts's/structureView.ts's own module comments named
 * this exact gap: "only main/a tag is ever rendered... never an arbitrary
 * branch commit"). `loadProjectionAtCommit` folds any commit via the
 * engine and serialises it into the same row shapes; the functions below
 * filter those arrays exactly as their SQL counterparts filter rows, so
 * each view hook can branch — main/tag via the existing `supabase`-backed
 * query, a branch ref via these — and hand its grouping/layout code
 * (which only ever cared about the row shape, never where it came from)
 * the same input either way.
 */
import type { RelationshipType, UUID } from '../contracts/delta';
import type { ElementsHeadRow, FactsRow, RelationshipsHeadRow } from '../contracts/rows';
import { attributesRecord } from '../ui/elements/attributesRecord';
import { cloneHead, type Head } from '../engine/deltas';
import { foldFromGenesis } from '../engine/head';
import { serializeHeadProjection, type HeadProjection } from '../engine/projection';
import { computeVersionDiff, type VersionDiff } from '../engine/versionDiff';
import { buildCommitLoader } from './commitLoader';
import type { Client } from './client';
import type { BranchRow } from './types';
import type { ViewMode } from './viewMode';

export async function loadProjectionAtCommit(supabase: Client, modelId: UUID, commitId: UUID): Promise<HeadProjection> {
  const loader = await buildCommitLoader(supabase, modelId);
  const head = foldFromGenesis(commitId, loader);
  return serializeHeadProjection(head);
}

export interface BranchModeProjection {
  /** The commit whose *structure* this projection reflects — `branch.base_commit_id` for `asIs`, `branch.head_commit_id` for `toBe` and `diff` (diff overlays highlighting on the to-be structure, per §6.2: "Diff = to-be with change highlighting relative to as-is"). */
  commitId: UUID;
  projection: HeadProjection;
  /** Populated only for `mode === 'diff'`. */
  diff: VersionDiff | null;
}

export interface BranchModeHead {
  /** The commit whose *structure* this Head reflects — `asIsCommitId` for `asIs`, `toBeCommitId` for `toBe` and `diff`. */
  commitId: UUID;
  head: Head;
  /** Populated only for `mode === 'diff'`. */
  diff: VersionDiff | null;
}

/**
 * The pure half of `resolveBranchModeProjection` below — no I/O, so it's
 * unit-testable directly with hand-built `Head`s. Diff mode's `Head` is
 * the to-be side with each *removed* element/relationship (present in
 * as-is, gone from to-be) added back in — §6.3: "Removed nodes stay on the
 * canvas in Diff mode (ghosted); they vanish in To-be." The `diff`
 * alongside it is what a renderer looks up per id to decide each node/
 * edge's added/removed/changed/moved/unchanged styling.
 */
export function selectBranchModeHead(asIsHead: Head, asIsCommitId: UUID, toBeHead: Head, toBeCommitId: UUID, mode: ViewMode): BranchModeHead {
  if (mode === 'asIs') return { commitId: asIsCommitId, head: asIsHead, diff: null };
  if (mode === 'toBe') return { commitId: toBeCommitId, head: toBeHead, diff: null };

  const diff = computeVersionDiff(asIsHead, toBeHead);
  const renderHead = cloneHead(toBeHead);
  for (const e of diff.elements) {
    if (e.state === 'removed' && e.asIs) renderHead.elements.set(e.elementId, e.asIs);
  }
  for (const r of diff.relationships) {
    if (r.state === 'removed' && r.asIs) renderHead.relationships.set(r.relationshipId, r.asIs);
  }
  return { commitId: toBeCommitId, head: renderHead, diff };
}

/**
 * The As-is/To-be/Diff selector's data (UI-principles §6.2/§6.3), for a
 * branch whose `base_commit_id`/`head_commit_id` are both real commits
 * (every branch past its own genesis fork). One `buildCommitLoader` call
 * folds both sides — they're commits on the same model, so this is one
 * round trip for commits/deltas, not two (same reasoning as
 * src/ui/versions/useVersionDiff.ts, which this mirrors for a branch's own
 * two sides instead of two arbitrary tags).
 */
export async function resolveBranchModeProjection(supabase: Client, modelId: UUID, branch: BranchRow, mode: ViewMode): Promise<BranchModeProjection | null> {
  if (!branch.base_commit_id || !branch.head_commit_id) return null;

  const loader = await buildCommitLoader(supabase, modelId);
  const asIsHead = foldFromGenesis(branch.base_commit_id, loader);
  const toBeHead = foldFromGenesis(branch.head_commit_id, loader);
  const selected = selectBranchModeHead(asIsHead, branch.base_commit_id, toBeHead, branch.head_commit_id, mode);

  return { commitId: selected.commitId, projection: serializeHeadProjection(selected.head), diff: selected.diff };
}

/** Mirrors src/db/elements.ts's `getElementHead`. */
export function projectionElementById(projection: HeadProjection, elementId: UUID): ElementsHeadRow | null {
  return projection.elementsHead.find((e) => e.element_id === elementId) ?? null;
}

/** Mirrors src/db/elements.ts's `getElementsByIds`. */
export function projectionElementsByIds(projection: HeadProjection, elementIds: readonly UUID[]): Map<UUID, ElementsHeadRow> {
  const ids = new Set(elementIds);
  return new Map(projection.elementsHead.filter((e) => ids.has(e.element_id)).map((e) => [e.element_id, e]));
}

/** Mirrors src/db/elements.ts's `listChildrenOf`, name-sorted to match. */
export function projectionChildrenOf(projection: HeadProjection, parentId: UUID): ElementsHeadRow[] {
  return projection.elementsHead.filter((e) => e.parent_id === parentId).sort((a, b) => a.name.localeCompare(b.name));
}

/** Mirrors src/db/elements.ts's `listRelationshipsForElement` — both directions. */
export function projectionRelationshipsForElement(projection: HeadProjection, elementId: UUID): RelationshipsHeadRow[] {
  return projection.relationshipsHead.filter((r) => r.from_element_id === elementId || r.to_element_id === elementId);
}

/** Mirrors src/db/elements.ts's `listFlowsViaElement` — Prompt 7k item 4's "Flows via this platform". */
export function projectionFlowsViaElement(projection: HeadProjection, platformElementId: UUID): RelationshipsHeadRow[] {
  return projection.relationshipsHead.filter((r) => (r.relationship_type === 'uses' || r.relationship_type === 'flows_to') && attributesRecord(r.attributes).via === platformElementId);
}

/** Mirrors src/db/elements.ts's `listFactsForSubject`, keyed the same way `useElementPage.ts`'s own `loadFacts` keys its result (by attribute). */
export function projectionFactsForSubject(projection: HeadProjection, subjectId: UUID): Map<string, FactsRow> {
  return new Map(projection.facts.filter((f) => f.subject_id === subjectId).map((f) => [f.attribute, f]));
}

/** Mirrors src/db/landscape.ts's `listSystemsForLandscape`, name-sorted to match. */
export function projectionSystemsForLandscape(projection: HeadProjection): ElementsHeadRow[] {
  return projection.elementsHead.filter((e) => e.element_type === 'system').sort((a, b) => a.name.localeCompare(b.name));
}

/** Mirrors src/db/landscape.ts's `listActorsForLandscape`, name-sorted to match. */
export function projectionActorsForLandscape(projection: HeadProjection): ElementsHeadRow[] {
  return projection.elementsHead.filter((e) => e.element_type === 'actor').sort((a, b) => a.name.localeCompare(b.name));
}

/** Mirrors src/db/landscape.ts's `listContainersForLandscape` ("platforms and modules": a platform's own module rows), name-sorted to match. */
export function projectionContainersForLandscape(projection: HeadProjection): ElementsHeadRow[] {
  return projection.elementsHead.filter((e) => e.element_type === 'container').sort((a, b) => a.name.localeCompare(b.name));
}

/** Mirrors src/db/landscape.ts's `listLandscapeEdges` — both endpoints in `systemIds` ∪ `actorIds` (S1 item 11a: an actor can be a `uses` edge's own `from` endpoint). */
export function projectionLandscapeEdges(projection: HeadProjection, systemIds: readonly UUID[], actorIds: readonly UUID[] = []): RelationshipsHeadRow[] {
  const ids = new Set([...systemIds, ...actorIds]);
  return projection.relationshipsHead.filter((r) => (r.relationship_type === 'uses' || r.relationship_type === 'flows_to') && ids.has(r.from_element_id) && ids.has(r.to_element_id));
}

/** Mirrors src/db/landscape.ts's `listSupportsEdgesForSystems`. */
export function projectionSupportsEdgesForSystems(projection: HeadProjection, systemIds: readonly UUID[]): RelationshipsHeadRow[] {
  const ids = new Set(systemIds);
  return projection.relationshipsHead.filter((r) => r.relationship_type === 'supports' && ids.has(r.from_element_id));
}

/** Mirrors src/db/structureView.ts's `listRelationshipsTouchingAny` — either endpoint in `subjectIds`. */
export function projectionRelationshipsTouchingAny(projection: HeadProjection, subjectIds: readonly UUID[], relationshipTypes: readonly RelationshipType[]): RelationshipsHeadRow[] {
  const ids = new Set(subjectIds);
  const types = new Set(relationshipTypes);
  return projection.relationshipsHead.filter((r) => types.has(r.relationship_type) && (ids.has(r.from_element_id) || ids.has(r.to_element_id)));
}
