import { useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import { listCapabilitiesForMap } from '../../db/capabilityMap';
import { computeSelfOwnedCapabilityIds, listAllOwnsEdges } from '../../db/healthFindings';
import { listContainersForLandscape, listSystemsForLandscape } from '../../db/landscape';
import { buildCapabilityTiles, listAllSupportsEdges, loadPlannedReplacements, type CapabilityTileData } from '../../db/modelHome';
import { refParamOf, resolveBranchRef, resolveRef, type Ref } from '../../db/ref';
import { listAllEnablesEdges, listValueStreamElements } from '../../db/valueStreams';
import { attributesRecord } from '../elements/attributesRecord';
import { reportError } from '../errors/errorBannerStore';
import { resolveBranchModeProjectionCached } from '../query/cachedBranchProjection';
import { supabase } from '../supabaseClient';
import { computeStageRollup, computeStreamRollup, stagesOf, streamsOf, type ValueStreamRollup, type ValueStreamStageRollup } from './valueStreamRollup';

/** One row of the Value streams page — a stream plus its own stages, each already rolled up. */
export interface ValueStreamRow {
  stream: ElementsHeadRow;
  rollup: ValueStreamRollup;
  stages: ValueStreamStageRollup[];
  inactive: boolean;
}

export interface ValueStreamData {
  commitId: UUID;
  rows: ValueStreamRow[];
  /** Every `value_stream` element (streams and stages both) — inspector lookups by id. */
  valueStreamsById: Map<UUID, ElementsHeadRow>;
  enablesEdges: RelationshipsHeadRow[];
  tilesByCapabilityId: Map<UUID, CapabilityTileData>;
  systemsById: Map<UUID, ElementsHeadRow>;
}

export type ValueStreamsState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'refNotFound' } | { status: 'ready'; data: ValueStreamData };

/**
 * The Value streams page's data (F6/ADR-023): every `value_stream` element
 * at the selected ref, grouped into streams (`parent_id === null`) and
 * their own stages, each rolled up via `valueStreamRollup.ts` against the
 * exact same per-capability tile data the director door and capability map
 * already compute (`src/db/modelHome.ts`'s `buildCapabilityTiles`) — no new
 * per-capability metric, only the two extra worst-of levels that module
 * adds. `buildCapabilityTiles` is handed only the capabilities that
 * actually enable a stage (any level, not just level-1 — see that
 * function's own doc comment), since that's the whole set this page's
 * rollups ever need a tile for.
 *
 * Same branch/main split as `useLandscape.ts`/`useDirectorHome.ts`: a
 * `change` branch's head is folded in memory (`resolveBranchModeProjectionCached`,
 * never materialised — SPEC §1 S-2), `main`/a tag reads `elements_head`/
 * `relationships_head` directly. `loadPlannedReplacements` is model-wide,
 * not ref-scoped (it reads `approved` branches' own delta history
 * regardless of which ref is selected — the same "computed once, model-
 * wide" shape `src/ui/decisions/compareOptions.ts` already uses it with).
 */
export function useValueStreams(
  modelId: UUID | null,
  ref: Ref,
  /** See `useLandscape.ts`'s identical parameter for why this hook waits for it rather than resolving `main` itself. */
  mainCommitIdHint: UUID | null = null,
): ValueStreamsState {
  const [state, setState] = useState<ValueStreamsState>({ status: 'loading' });
  const refParam = refParamOf(ref);

  useEffect(() => {
    if (!modelId) return undefined;
    if (ref.kind === 'main' && !mainCommitIdHint) return undefined;
    const currentModelId = modelId;
    let cancelled = false;
    setState({ status: 'loading' });

    async function load(): Promise<void> {
      let commitId: UUID;
      let valueStreams: ElementsHeadRow[];
      let enablesEdges: RelationshipsHeadRow[];
      let capabilities: ElementsHeadRow[];
      let supportsEdges: RelationshipsHeadRow[];
      let ownsEdges: RelationshipsHeadRow[];
      let systems: ElementsHeadRow[];
      let containers: ElementsHeadRow[];

      if (ref.kind === 'branch') {
        const branch = await resolveBranchRef(supabase, ref);
        if (!branch) {
          if (!cancelled) setState({ status: 'refNotFound' });
          return;
        }
        const resolved = await resolveBranchModeProjectionCached(supabase, currentModelId, branch, 'toBe');
        if (!resolved) {
          if (!cancelled) setState({ status: 'refNotFound' });
          return;
        }
        commitId = resolved.commitId;
        const { projection } = resolved;
        valueStreams = projection.elementsHead.filter((e) => e.element_type === 'value_stream');
        enablesEdges = projection.relationshipsHead.filter((r) => r.relationship_type === 'enables');
        capabilities = projection.elementsHead.filter((e) => e.element_type === 'capability');
        supportsEdges = projection.relationshipsHead.filter((r) => r.relationship_type === 'supports');
        ownsEdges = projection.relationshipsHead.filter((r) => r.relationship_type === 'owns');
        // system-only: modules are loaded into `containers` on the next line.
        systems = projection.elementsHead.filter((e) => e.element_type === 'system');
        containers = projection.elementsHead.filter((e) => e.element_type === 'container');
      } else {
        const resolvedCommitId = ref.kind === 'main' && mainCommitIdHint ? mainCommitIdHint : await resolveRef(supabase, currentModelId, ref);
        if (!resolvedCommitId) {
          if (!cancelled) setState({ status: 'refNotFound' });
          return;
        }
        commitId = resolvedCommitId;
        [valueStreams, enablesEdges, capabilities, supportsEdges, ownsEdges, systems, containers] = await Promise.all([
          listValueStreamElements(supabase, commitId),
          listAllEnablesEdges(supabase, commitId),
          listCapabilitiesForMap(supabase, commitId),
          listAllSupportsEdges(supabase, commitId),
          listAllOwnsEdges(supabase, commitId),
          listSystemsForLandscape(supabase, commitId),
          listContainersForLandscape(supabase, commitId),
        ]);
      }

      const plannedReplacements = await loadPlannedReplacements(supabase, currentModelId);
      const systemsById = new Map<UUID, ElementsHeadRow>([...systems, ...containers].map((s) => [s.element_id, s]));
      const selfOwnedIds = computeSelfOwnedCapabilityIds(capabilities, supportsEdges, ownsEdges);

      const enablingCapabilityIds = new Set(enablesEdges.map((edge) => edge.from_element_id));
      const capabilitiesById = new Map(capabilities.map((c) => [c.element_id, c]));
      const enablingCapabilities = [...enablingCapabilityIds].map((id) => capabilitiesById.get(id)).filter((c): c is ElementsHeadRow => c !== undefined);
      const tiles = buildCapabilityTiles(enablingCapabilities, capabilities, supportsEdges, systemsById, plannedReplacements, selfOwnedIds);
      const tilesByCapabilityId = new Map(tiles.map((tile) => [tile.capability.element_id, tile]));

      const rows: ValueStreamRow[] = streamsOf(valueStreams).map((stream) => {
        const stages = stagesOf(stream, valueStreams).map((stage) => computeStageRollup(stage, enablesEdges, tilesByCapabilityId));
        const rollup = computeStreamRollup(stream, stages);
        return { stream, rollup, stages, inactive: attributesRecord(stream.attributes).inactive === true };
      });

      const valueStreamsById = new Map(valueStreams.map((e) => [e.element_id, e]));
      if (!cancelled) setState({ status: 'ready', data: { commitId, rows, valueStreamsById, enablesEdges, tilesByCapabilityId, systemsById } });
    }

    load().catch((e: unknown) => {
      reportError("Couldn't load value streams.", e);
      if (!cancelled) setState({ status: 'error', message: e instanceof Error ? e.message : 'Failed to load value streams' });
    });

    return () => {
      cancelled = true;
    };
    // `ref`'s string form (`refParam`) is the real dependency, same
    // convention and pitfall as `useLandscape.ts` — `ref` itself is read
    // from the closure, always the latest one.
  }, [modelId, refParam, mainCommitIdHint]);

  return state;
}
