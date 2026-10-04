import { useCallback, useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import type { ElementsHeadRow } from '../../contracts/rows';
import { listChangeBranches } from '../../db/branches';
import { listCapabilitiesForMap } from '../../db/capabilityMap';
import { listOwnsEdges } from '../../db/elementBrowse';
import { computeSelfOwnedCapabilityIds } from '../../db/healthFindings';
import { listContainersForLandscape, listSystemsForLandscape } from '../../db/landscape';
import {
  buildCapabilityTiles,
  commitsSincePreviousTag,
  loadCommitDepths,
  loadModelCounts,
  loadPlannedReplacements,
  listAllSupportsEdges,
  type CapabilityTileData,
  type ModelCounts,
} from '../../db/modelHome';
import { listDecisionsForModel } from '../../db/decisions';
import { listOrgMemberProfiles, listProfilesByIds } from '../../db/profiles';
import { listProjectsForModel } from '../../db/projects';
import { listTagsForModel } from '../../db/tags';
import type { ProfileRow, TagRow } from '../../db/types';
import { resolveRef } from '../../db/ref';
import { computeCapabilityMapTree } from '../capabilityMap/layout';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';
import { buildWhatWeAreDoing, type WhatWeAreDoing } from './whatWeAreDoing';

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
  versions: VersionStamp[];
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

      const [capabilities, supportsEdges, systems, containers, counts, changeBranches, tags, plannedReplacements, ownsEdges, projects, decisions, memberProfiles] = await Promise.all([
        listCapabilitiesForMap(supabase, commitId),
        listAllSupportsEdges(supabase, commitId),
        listSystemsForLandscape(supabase, commitId),
        listContainersForLandscape(supabase, commitId),
        loadModelCounts(supabase, commitId, modelId),
        listChangeBranches(supabase, modelId),
        listTagsForModel(supabase, modelId),
        loadPlannedReplacements(supabase, modelId),
        listOwnsEdges(supabase, commitId),
        listProjectsForModel(supabase, modelId),
        listDecisionsForModel(supabase, modelId),
        // Owner names for "What we're doing" — every org member's profile in
        // one org-scoped read, never an `.in()` over owner ids (CLAUDE.md
        // rule 8: that list grows with the model).
        listOrgMemberProfiles(supabase, orgId),
      ]);

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
      const selfOwnedIds = computeSelfOwnedCapabilityIds(capabilities, supportsEdges, ownsEdges);
      const tiles = buildCapabilityTiles(level1Capabilities, capabilities, supportsEdges, systemsById, plannedReplacements, selfOwnedIds);
      const exposedCount = tiles.filter((t) => t.tone === 'warn' || t.tone === 'info').length;
      const unrecordedCount = tiles.filter((t) => t.tone === 'neutral').length;

      const today = new Date().toISOString().slice(0, 10);
      const whatWeAreDoing = buildWhatWeAreDoing(projects, decisions, changeBranches, new Map(memberProfiles.map((p) => [p.user_id, p])), today);

      const recentTags = [...tags].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 3);
      // One older tag beyond the three shown is enough to compute the
      // oldest-shown one's own "commits since previous" — sorted the same
      // way, so index 3 (if it exists) is the tag right before recentTags[2].
      const allSortedTags = [...tags].sort((a, b) => b.created_at.localeCompare(a.created_at));
      const depthLookupCommitIds = allSortedTags.slice(0, 4).map((t) => t.commit_id);
      const depths = await loadCommitDepths(supabase, depthLookupCommitIds);
      const authorIds = [...new Set(recentTags.map((t) => t.created_by))];
      const profiles = await listProfilesByIds(supabase, authorIds);
      const profileById = new Map<UUID, ProfileRow>(profiles.map((p) => [p.user_id, p]));

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
          data: { tiles, exposedCount, unrecordedCount, counts, whatWeAreDoing, versions },
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
