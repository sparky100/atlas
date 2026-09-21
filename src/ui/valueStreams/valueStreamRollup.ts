/**
 * The value-stream rollup (ADR-023/F6, "Rollup" section): a two-level
 * worst-of over the exact same per-capability data the director door and
 * capability map already compute (`src/db/modelHome.ts`'s `CapabilityTileData`,
 * via `buildCapabilityTiles`) — no new per-capability metric, only two more
 * levels of "worst of the children" above it.
 *
 * Severity order (the one judgment call this rollup needs, stated in
 * ADR-023): `warn` (exposed, no planned replacement) > `neutral` (nothing
 * recorded — a coverage gap) > `info` (exposed, replacement planned) >
 * `ok`. A stage's tone is the worst among the capabilities that enable it,
 * or `neutral` — itself a coverage gap — when nothing enables it at all. A
 * stream's tone is the worst among its stages. `fitForPurpose` rolls up
 * the same way but stays a separate field, never folded into the tone, so
 * "a stage's tone equals the worst of its enabling capabilities' tones" is
 * an exact property (P-34) with `CapabilityTileData.tone` as its own oracle.
 */
import type { FitForPurpose, UUID } from '../../contracts/delta';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import { FIT_FOR_PURPOSE_ORDER } from '../elements/fitForPurposeTone';
import { compareBySiblingOrder } from '../elements/siblingOrder';
import type { CapabilityTileData } from '../../db/modelHome';

export type ValueStreamTone = CapabilityTileData['tone'];

/** Index = severity, worst last — `warn` outranks `neutral` outranks `info` outranks `ok` (ADR-023's own stated order). */
export const TONE_SEVERITY: readonly ValueStreamTone[] = ['ok', 'info', 'neutral', 'warn'];

/** The worst (highest-severity) tone among `tones`, or `undefined` if the list is empty — callers that have their own "nothing here" tone (a stage with no enabling capability reads `neutral`, not "undefined") supply it themselves rather than this function guessing one. */
export function worstTone(tones: readonly ValueStreamTone[]): ValueStreamTone | undefined {
  let worst: ValueStreamTone | undefined;
  for (const tone of tones) {
    if (worst === undefined || TONE_SEVERITY.indexOf(tone) > TONE_SEVERITY.indexOf(worst)) worst = tone;
  }
  return worst;
}

/** `worstFitForPurpose`'s own worst-of, generalised to any set of already-computed ratings (a capability's own subtree-rolled-up rating here, rather than a single edge) — `poor` the worst, `null` when none of them is rated. */
function worstFitForPurposeOf(ratings: readonly (FitForPurpose | null)[]): FitForPurpose | null {
  let worst: FitForPurpose | null = null;
  for (const rating of ratings) {
    if (rating !== null && (worst === null || FIT_FOR_PURPOSE_ORDER[rating] > FIT_FOR_PURPOSE_ORDER[worst])) worst = rating;
  }
  return worst;
}

export interface ValueStreamStageRollup {
  stage: ElementsHeadRow;
  tone: ValueStreamTone;
  /** Every capability with a live `enables` edge onto this stage — a stage is commonly enabled by more than one. */
  enablingCapabilityIds: readonly UUID[];
  fitForPurpose: FitForPurpose | null;
}

/**
 * @param stage The value_stream element to roll up (a stage — one with a non-null `parentId`; callers never call this on a stream).
 * @param enablesEdges Every live `enables` edge in scope, already filtered to `relationship_type === 'enables'` (the same "caller filters by type first" convention `capabilityRollup.ts`'s own `supportsEdges` parameter uses).
 * @param tilesByCapabilityId `buildCapabilityTiles`'s own output, keyed by capability id — called with the set of capabilities that actually enable stages (any level), not just level-1 ones; `buildCapabilityTiles` is already generic over which capabilities it's handed.
 */
export function computeStageRollup(stage: ElementsHeadRow, enablesEdges: readonly RelationshipsHeadRow[], tilesByCapabilityId: ReadonlyMap<UUID, CapabilityTileData>): ValueStreamStageRollup {
  const enablingCapabilityIds = enablesEdges.filter((edge) => edge.to_element_id === stage.element_id).map((edge) => edge.from_element_id);
  const tiles = enablingCapabilityIds.map((id) => tilesByCapabilityId.get(id)).filter((tile): tile is CapabilityTileData => tile !== undefined);
  // A stage nothing enables is itself a coverage gap — the same "nothing
  // recorded" fact `neutral` already means for a capability with no
  // supporting system — not a separate, undefined state.
  const tone = tiles.length === 0 ? 'neutral' : (worstTone(tiles.map((tile) => tile.tone)) ?? 'neutral');
  return { stage, tone, enablingCapabilityIds, fitForPurpose: worstFitForPurposeOf(tiles.map((tile) => tile.fitForPurpose)) };
}

export interface ValueStreamRollup {
  stream: ElementsHeadRow;
  tone: ValueStreamTone;
  fitForPurpose: FitForPurpose | null;
}

/** @param stageRollups This stream's own stages' rollups (`stagesOf` + `computeStageRollup`, one per stage) — a stream with no stages reads `neutral`, the same "nothing recorded" default a stage with no enabling capability already uses. */
export function computeStreamRollup(stream: ElementsHeadRow, stageRollups: readonly ValueStreamStageRollup[]): ValueStreamRollup {
  const tone = stageRollups.length === 0 ? 'neutral' : (worstTone(stageRollups.map((rollup) => rollup.tone)) ?? 'neutral');
  return { stream, tone, fitForPurpose: worstFitForPurposeOf(stageRollups.map((rollup) => rollup.fitForPurpose)) };
}

/** A stream's own stages (`parent_id === stream.element_id`), in display order (`compareBySiblingOrder` — the same comparator capability siblings use, ADR-023's own "stages left to right"). */
export function stagesOf(stream: ElementsHeadRow, allValueStreams: readonly ElementsHeadRow[]): ElementsHeadRow[] {
  return allValueStreams.filter((element) => element.parent_id === stream.element_id).sort(compareBySiblingOrder);
}

/** Every stream (`parent_id === null`) among `allValueStreams`, in display order — the Value streams page's own top-level row list (Step 4). */
export function streamsOf(allValueStreams: readonly ElementsHeadRow[]): ElementsHeadRow[] {
  return allValueStreams.filter((element) => element.parent_id === null).sort(compareBySiblingOrder);
}
