import type { UUID } from '../../contracts/delta';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import type { CapabilityMapTree } from './layout';
import { aggregateTileColourFor, tileColourFor, type ColourByMode } from './metrics';

/**
 * The whole-map view's tint rule: only a problem is tinted, never a healthy or
 * unknown capability (`ok`, `neutral` and "nothing to say" all stay plain).
 * `danger` and `warn` are problems; `info` is a problem someone has already
 * planned around ("replacement planned"). The colours keep the one meaning
 * they have everywhere else in the app, because the tone itself comes from the
 * same `metrics.ts` the list view uses.
 */
export type WholeMapTone = 'danger' | 'warn' | 'info';

export interface WholeMapTile {
  capability: ElementsHeadRow;
  tone: WholeMapTone | undefined;
  /** The plain-words reason, shown beside the tint so colour is never the only signal. */
  label: string | undefined;
}

export interface WholeMapColumn {
  domain: ElementsHeadRow;
  tone: WholeMapTone | undefined;
  label: string | undefined;
  tiles: WholeMapTile[];
}

export interface WholeMap {
  columns: WholeMapColumn[];
  /** Each distinct tint on the page with its words, for the legend. Empty when nothing is a problem. */
  legend: { tone: WholeMapTone; label: string }[];
  problemCount: number;
}

function problemOnly(tone: string | undefined, label: string | undefined): { tone: WholeMapTone | undefined; label: string | undefined } {
  if ((tone === 'danger' || tone === 'warn' || tone === 'info') && label !== undefined) return { tone, label };
  return { tone: undefined, label: undefined };
}

export function buildWholeMap(tree: CapabilityMapTree, mode: ColourByMode, supportsEdges: readonly RelationshipsHeadRow[], systemsById: ReadonlyMap<UUID, ElementsHeadRow>, replacedIds: ReadonlySet<UUID>): WholeMap {
  const seen = new Map<string, WholeMapTone>();
  let problemCount = 0;
  const columns = tree.l1.map((column) => {
    const tiles = column.l2.map((card) => {
      const colour = tileColourFor(mode, card.capability.element_id, supportsEdges, systemsById, replacedIds);
      const { tone, label } = problemOnly(colour.tone, colour.label);
      if (tone !== undefined && label !== undefined) {
        seen.set(label, tone);
        problemCount += 1;
      }
      return { capability: card.capability, tone, label };
    });
    const subtreeIds = [column.capability.element_id, ...column.l2.flatMap((card) => [card.capability.element_id, ...card.l3.map((leaf) => leaf.element_id)])];
    const aggregate = aggregateTileColourFor(mode, subtreeIds, supportsEdges, systemsById, replacedIds);
    const { tone, label } = problemOnly(aggregate.tone, aggregate.label);
    return { domain: column.capability, tone, label, tiles };
  });
  return { columns, legend: [...seen.entries()].map(([label, tone]) => ({ tone, label })), problemCount };
}
