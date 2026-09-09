/**
 * The capability map's grouping (UI-principles.md §6.1: "nested tiles, L1
 * as columns, L2 as stacked cards, L3 on zoom" — "structure is nesting",
 * no edges). Unlike the landscape's swim-lane layout (src/ui/landscape/
 * layout.ts), this produces no pixel coordinates at all: the capability
 * map renders as real DOM/CSS (flex/grid), not Canvas — there is no
 * UI-principles §8.6 performance budget for this view (that budget is
 * named for "a landscape view" specifically, at a stated 2,000/4,000
 * scale no capability map is expected to reach), so the simpler,
 * more-accessible-by-default DOM renderer is the right call here, not a
 * hand-rolled hit-testing/culling system a treemap of a few dozen tiles
 * doesn't need. "The layout algorithm" this file provides is grouping and
 * deterministic ordering; CSS does the actual placement.
 *
 * Depth (L1/L2/L3) is derived from the real `parent_id` chain, not from
 * the `level` attribute — SPEC §6.3's V2 validates that a capability's
 * parent, if any, is another capability, but never that `level` matches
 * actual nesting depth. Trusting structure over a possibly-stale
 * attribute means a mismatched `level` value can't misplace a tile.
 */
import type { ElementsHeadRow } from '../../contracts/rows';
import type { UUID } from '../../contracts/delta';
import { attributesRecord } from '../elements/attributesRecord';

export interface L3Tile {
  capability: ElementsHeadRow;
}

export interface L2Card {
  capability: ElementsHeadRow;
  l3: ElementsHeadRow[];
}

export interface L1Column {
  capability: ElementsHeadRow;
  l2: L2Card[];
}

export interface CapabilityMapTree {
  l1: L1Column[];
  /**
   * Anything that doesn't fit cleanly: nesting deeper than L3, a broken
   * parent reference, or a parent cycle. Shown, not hidden — a gap made
   * visible (CLAUDE.md rule 7), the same stance the element page takes on
   * a missing required attribute.
   */
  orphans: ElementsHeadRow[];
}

/** Splits a dotted code (`"2.10"`) into comparable numeric groups so `2.2` sorts before `2.10` — a plain string compare would put `2.10` first. Falls back to string comparison wherever a segment isn't numeric. */
function compareCodes(a: string, b: string): number {
  const as = a.split('.');
  const bs = b.split('.');
  const len = Math.max(as.length, bs.length);
  for (let i = 0; i < len; i++) {
    const av = as[i] ?? '';
    const bv = bs[i] ?? '';
    const an = Number(av);
    const bn = Number(bv);
    if (av !== '' && bv !== '' && Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return an - bn;
    if (av !== bv) return av.localeCompare(bv);
  }
  return 0;
}

function codeOf(capability: ElementsHeadRow): string | null {
  const code = attributesRecord(capability.attributes).code;
  return typeof code === 'string' && code !== '' ? code : null;
}

function orderOf(capability: ElementsHeadRow): number | null {
  const order = attributesRecord(capability.attributes).order;
  return typeof order === 'number' ? order : null;
}

/**
 * Deterministic order: by `attributes.order` (Sprint U4-1 C1) when both
 * tiles have one — this is what actually puts a sector map's own
 * capabilities first and the eight shared back-office ones last
 * (content/capability-maps/README.md's ordering convention,
 * `useCapabilityReorder.ts`'s own tailoring-flow updates to it); falls
 * back to `code` (numeric-aware) when either tile lacks an order, then
 * name, then id as the final tiebreak. A capability with no order (never
 * seeded from a map, or hand-added and not yet given one) always sorts
 * after every ordered sibling, never before — landing at the end of its
 * group rather than jumping ahead of capabilities someone deliberately
 * placed.
 */
export function compareCapabilities(a: ElementsHeadRow, b: ElementsHeadRow): number {
  const orderA = orderOf(a);
  const orderB = orderOf(b);
  if (orderA !== null && orderB !== null) {
    if (orderA !== orderB) return orderA - orderB;
  } else if (orderA !== null) {
    return -1;
  } else if (orderB !== null) {
    return 1;
  }

  const codeA = codeOf(a);
  const codeB = codeOf(b);
  if (codeA !== null && codeB !== null) {
    const byCode = compareCodes(codeA, codeB);
    if (byCode !== 0) return byCode;
  }
  return a.name.localeCompare(b.name) || a.element_id.localeCompare(b.element_id);
}

/** `capability.parent_id`'s depth from a root (0), or `null` if it can't be resolved cleanly (missing parent, or a cycle) within `maxDepth` hops. */
function depthOf(capability: ElementsHeadRow, byId: Map<UUID, ElementsHeadRow>, maxDepth: number): number | null {
  let current = capability;
  const seen = new Set<UUID>([current.element_id]);
  for (let depth = 0; depth <= maxDepth; depth++) {
    if (current.parent_id === null) return depth;
    const parent = byId.get(current.parent_id);
    if (!parent || seen.has(parent.element_id)) return null;
    seen.add(parent.element_id);
    current = parent;
  }
  return null;
}

export function computeCapabilityMapTree(capabilities: readonly ElementsHeadRow[]): CapabilityMapTree {
  const byId = new Map(capabilities.map((c) => [c.element_id, c]));
  const byParent = new Map<UUID | null, ElementsHeadRow[]>();
  for (const capability of capabilities) {
    const list = byParent.get(capability.parent_id) ?? [];
    list.push(capability);
    byParent.set(capability.parent_id, list);
  }

  const orphans: ElementsHeadRow[] = [];
  const l1Candidates: ElementsHeadRow[] = [];
  for (const capability of capabilities) {
    const depth = depthOf(capability, byId, 2);
    if (depth === null) orphans.push(capability);
    else if (depth === 0) l1Candidates.push(capability);
    // depth 1/2 (L2/L3) are reached below, from their L1 ancestor's
    // children — never pushed here directly.
  }

  const l1 = [...l1Candidates].sort(compareCapabilities).map((l1Capability): L1Column => {
    const l2Candidates = (byParent.get(l1Capability.element_id) ?? []).filter((c) => depthOf(c, byId, 2) === 1);
    const l2 = [...l2Candidates].sort(compareCapabilities).map((l2Capability): L2Card => {
      const l3Candidates = (byParent.get(l2Capability.element_id) ?? []).filter((c) => depthOf(c, byId, 2) === 2);
      return { capability: l2Capability, l3: [...l3Candidates].sort(compareCapabilities) };
    });
    return { capability: l1Capability, l2 };
  });

  return { l1, orphans: orphans.sort(compareCapabilities) };
}
