import { useCallback, useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import type { ElementsHeadRow } from '../../contracts/rows';
import { supportsEdgesInForce } from '../../engine/elementRead/fitAndExposure';
import { listChangeBranches } from '../../db/branches';
import { listOwnsEdges } from '../../db/elementBrowse';
import { computeSelfOwnedCapabilityIds, listOpenProjectScopeForModel } from '../../db/healthFindings';
import {
  buildCapabilityTiles,
  commitsSincePreviousTag,
  deriveModelCounts,
  listAllSupportsEdges,
  listDirectorElementHeads,
  loadCommitDepths,
  loadPlannedReplacementsForBranches,
  type CapabilityTileData,
  type ModelCounts,
} from '../../db/modelHome';
import { listDecisionsForModel, listOpenDecisionElementLinksForModel } from '../../db/decisions';
import { listDecisionOptionsForModel } from '../../db/decisionOptions';
import { listOrgMemberProfiles, listProfilesByIds } from '../../db/profiles';
import { listProjectsForModel } from '../../db/projects';
import { listTagsForModel } from '../../db/tags';
import type { ProfileRow, TagRow } from '../../db/types';
import { resolveRef } from '../../db/ref';
import { computeCapabilityMapTree } from '../capabilityMap/layout';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';
import { computeTileInHand, type TileInHand } from './tileInHand';
import { buildRecentRecords, buildWhatWeAreDoing, type RecentRecord, type WhatWeAreDoing } from './whatWeAreDoing';

export interface VersionStamp {
  tag: TagRow;
  /** The tagging user's `atlas.profiles` display name/handle, falling back to their bare id if they have no profile visible (shouldn't happen past first membership — SPEC §3.2 — but never blocks the stamp on it). */
  authorDisplay: string;
  /** `null` for the oldest tag on the model — nothing to compare against. */
  commitsSincePrevious: number | null;
}

export interface DirectorHomeData {
  tiles: CapabilityTileData[];
  exposedCount: number;
  unrecordedCount: number;
  counts: ModelCounts;
  /** "What we're doing" (UI-principles §3, 2026-10-04): projects in hand and open decisions outside any project — `whatWeAreDoing.ts`. Replaces Handoff 7d's "What's changing" list of raw changes. */
  whatWeAreDoing: WhatWeAreDoing;
  /** Per level-1 tile (by capability id): the open projects and decisions already addressing it — `tileInHand.ts`. */
  inHandByTile: ReadonlyMap<UUID, TileInHand>;
  versions: VersionStamp[];
  /** Decisions made and projects ended since the newest version (all of them while there is none) — `buildRecentRecords`. */
  recentRecords: RecentRecord[];
  /** The newest version those are counted from, or `null` when nothing is tagged yet. */
  recentSince: TagRow | null;
}

type DirectorHomeLoadState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: DirectorHomeData };

/** A callable `reload` alongside the same load-state union every other door/route hook already returns — kept as an intersection (not folded into each branch by hand) so the union stays discriminable on `status`. */
export type DirectorHomeState = DirectorHomeLoadState & { reload: () => void };

/**
 * The director door's data (UI-principles §3.1, built to Handoff 7d —
 * `docs/HANDOFF-7d-director-door.md`). Always reads `main` — the
 * director's door has no branch selector (§3.1: "no sidebar, no branch
 * selector, no editing affordance"). Still not built: §3.1's Coverage/
 * Staleness/Confidence toggles beyond Lifecycle Exposure, and the
 * director's branch-scoped to-be zoom (`src/db/modelHome.ts`'s own module
 * comment).
 */
export function useDirectorHome(
  modelId: UUID,
  orgId: UUID,
  /** S1 item 15 (A2 remainder): the caller's own already-resolved main head commit id — this hook only ever reads `main`, so a caller with one already in hand (`useMainBranch`) skips this hook's own `resolveRef` round trip entirely. */
  mainCommitIdHint: UUID | null = null,
): DirectorHomeState {
  const [state, setState] = useState<DirectorHomeLoadState>({ status: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);
  const reload = useCallback(() => {
    setReloadToken((t) => t + 1);
  }, []);

  useEffect(() => {
    if (!modelId) return undefined;
    let cancelled = false;
    setState({ status: 'loading' });

    async function load(): Promise<void> {
      const commitId = mainCommitIdHint ?? (await resolveRef(supabase, modelId, { kind: 'main' }));
      if (!commitId) {
        // ADR-018: a real model's main always has a head. An empty tree
        // (no capabilities yet) is `ready` with zero tiles, not this.
        if (!cancelled) setState({ status: 'error', message: 'This model has no commits yet.' });
        return;
      }

      // One wave, no serial tail. Everything below starts together; the
      // reads that depend on another read's result (planned replacements
      // need the approved change branches; commit depths need the tags;
      // tag authors' names need the tags and the org's member profiles) are
      // chained onto that read's own promise instead of awaited after the
      // wave, so the slowest chain — not the sum of two chains — sets the
      // time to first paint. Counts come from the lists already loaded
      // (`deriveModelCounts`), and capabilities, systems and containers come
      // from one `elements_head` read rather than three plus two count
      // HEADs: each `elements_head` read pays a per-row commit visibility
      // check, so a redundant one is not free.
      const changeBranchesRequest = listChangeBranches(supabase, modelId);
      const tagsRequest = listTagsForModel(supabase, modelId);
      // Owner names for "What we're doing" — every org member's profile in
      // one org-scoped read, never an `.in()` over owner ids (CLAUDE.md
      // rule 8: that list grows with the model).
      const memberProfilesRequest = listOrgMemberProfiles(supabase, orgId);
      const plannedReplacementsRequest = changeBranchesRequest.then((branches) =>
        loadPlannedReplacementsForBranches(
          supabase,
          branches.filter((b) => b.status === 'approved').map((b) => b.id),
        ),
      );
      // One older tag beyond the three shown is enough to compute the
      // oldest-shown one's own "commits since previous" — newest first, so
      // index 3 (if it exists) is the tag right before the third shown.
      const sortedTagsOf = (tags: readonly TagRow[]): TagRow[] => [...tags].sort((a, b) => b.created_at.localeCompare(a.created_at));
      const depthsRequest = tagsRequest.then((tags) => loadCommitDepths(supabase, sortedTagsOf(tags).slice(0, 4).map((t) => t.commit_id)));
      // A tagging user is nearly always an org member, so their profile is already in hand; only a missing one (a former member) costs a lookup.
      const authorProfilesRequest = Promise.all([tagsRequest, memberProfilesRequest]).then(([tags, members]) => {
        const known = new Set(members.map((p) => p.user_id));
        const missing = [...new Set(sortedTagsOf(tags).slice(0, 3).map((t) => t.created_by))].filter((id) => !known.has(id));
        return listProfilesByIds(supabase, missing);
      });

      const [elementHeads, supportsEdges, changeBranches, tags, plannedReplacements, ownsEdges, projects, decisions, memberProfiles, projectScope, decisionElementLinks, depths, authorProfiles, decisionOptions] = await Promise.all([
        listDirectorElementHeads(supabase, commitId),
        listAllSupportsEdges(supabase, commitId),
        changeBranchesRequest,
        tagsRequest,
        plannedReplacementsRequest,
        listOwnsEdges(supabase, commitId),
        listProjectsForModel(supabase, modelId),
        listDecisionsForModel(supabase, modelId),
        memberProfilesRequest,
        // What's addressing each weak tile — both model-scoped, no id list.
        listOpenProjectScopeForModel(supabase, modelId),
        listOpenDecisionElementLinksForModel(supabase, modelId),
        depthsRequest,
        authorProfilesRequest,
        // So a chosen option on "Projects in hand" can say where its delivery has got to.
        listDecisionOptionsForModel(supabase, modelId),
      ]);
      const { capabilities, systems, containers } = elementHeads;
      const counts = deriveModelCounts(capabilities, systems, changeBranches);

      // Bug fix: a `supports` edge's own `from_element_id` can be a
      // container just as validly as a system (S1 item 20 — a platform's
      // own module supports a capability directly) — `buildCapabilityTiles`/
      // `computeExposureTone` (`modelHome.ts`) both silently drop any edge
      // whose supporter isn't in this map, so a capability supported only
      // by a container used to read as "no known supporters" here even
      // though its own element page showed the real relationship.
      const systemsById = new Map<UUID, ElementsHeadRow>([...systems, ...containers].map((s) => [s.element_id, s]));
      // Handoff 7d's grid is level-1 tiles only — `listCapabilitiesForMap`
      // returns every level (1-3); computeCapabilityMapTree's own `l1`
      // array is the real, parent_id-derived level-1 set (never a fixed
      // "12 tiles" count — it reflows to however many a map actually has).
      const level1Capabilities = computeCapabilityMapTree(capabilities).l1.map((column) => column.capability);
      // Capability rollup's own owner-coverage input (`healthFindings.ts`'s
      // `computeSelfOwnedCapabilityIds`) — the whole model's capabilities,
      // not just level-1, since a business owner can sit anywhere in the
      // tree and still roll up to its level-1 ancestor.
      // A system past its planned end stops counting as supporting a capability (Retire copies links to the replacement and keeps the old ones).
      const supportsInForce = supportsEdgesInForce(supportsEdges, systemsById);
      const selfOwnedIds = computeSelfOwnedCapabilityIds(capabilities, supportsInForce, ownsEdges);
      const tiles = buildCapabilityTiles(level1Capabilities, capabilities, supportsInForce, systemsById, plannedReplacements, selfOwnedIds);
      const exposedCount = tiles.filter((t) => t.tone === 'warn' || t.tone === 'info').length;
      const unrecordedCount = tiles.filter((t) => t.tone === 'neutral').length;

      const today = new Date().toISOString().slice(0, 10);
      const whatWeAreDoing = buildWhatWeAreDoing(projects, decisions, changeBranches, new Map(memberProfiles.map((p) => [p.user_id, p])), today, decisionOptions);
      const inHandByTile = computeTileInHand(tiles, capabilities, projectScope, decisionElementLinks, decisions);

      const allSortedTags = sortedTagsOf(tags);
      const recentTags = allSortedTags.slice(0, 3);
      const profileById = new Map<UUID, ProfileRow>([...memberProfiles, ...authorProfiles].map((p) => [p.user_id, p]));

      const recentSince = allSortedTags[0] ?? null;
      const recentRecords = buildRecentRecords(decisions, projects, recentSince?.created_at ?? null);

      const versions: VersionStamp[] = recentTags.map((tag, index) => {
        const olderTag = allSortedTags[index + 1];
        const newerDepth = depths.get(tag.commit_id) ?? null;
        const olderDepth = olderTag ? (depths.get(olderTag.commit_id) ?? null) : null;
        const commitsSincePrevious = newerDepth !== null ? commitsSincePreviousTag(newerDepth, olderDepth) : null;
        const profile = profileById.get(tag.created_by);
        const authorDisplay = profile?.display_name ?? profile?.handle ?? tag.created_by;
        return { tag, authorDisplay, commitsSincePrevious };
      });

      if (!cancelled) {
        setState({
          status: 'ready',
          data: { tiles, exposedCount, unrecordedCount, counts, whatWeAreDoing, inHandByTile, versions, recentRecords, recentSince },
        });
      }
    }

    load().catch((e: unknown) => {
      reportError("Couldn't load the director view.", e);
      if (!cancelled) setState({ status: 'error', message: e instanceof Error ? e.message : 'Failed to load the director view' });
    });

    return () => {
      cancelled = true;
    };
  }, [modelId, orgId, reloadToken, mainCommitIdHint]);

  return { ...state, reload };
}
