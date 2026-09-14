import type { UUID } from '../../contracts/delta';
import type { ElementsHeadRow } from '../../contracts/rows';

/**
 * A capability's level (1–3), computed from real `parent_id` nesting depth
 * — never a stored, independently-editable attribute (ADR-016, amending
 * ADR-001; see src/contracts/delta.ts's CapabilityAttributes comment).
 * Capability nesting is capped at 3 levels, so this only ever needs the
 * immediate parent and grandparent, not an unbounded walk — the caller
 * fetches at most those two extra rows (only for a capability, only when
 * a parent exists at all).
 *
 * Returns `null` when the chain doesn't resolve to a clean level within 3
 * — a parent whose own parent has yet another parent (SPEC's V2 never
 * forbids this, it just isn't a level 1–3 map any more) — same "shown as
 * a gap, not silently misplaced" stance src/ui/capabilityMap/layout.ts
 * takes on the identical case.
 */
export function capabilityLevel(parent: ElementsHeadRow | null, grandparent: ElementsHeadRow | null): number | null {
  if (!parent) return 1;
  if (parent.parent_id === null) return 2;
  if (!grandparent) return null;
  if (grandparent.parent_id === null) return 3;
  return null;
}

/**
 * A capability's own level-1 ancestor (itself, if it already is one) —
 * Sprint U4-1 B4's "lanes are level-1 capabilities only; every supports
 * rolls up to its level-1 ancestor via parent_id." `allCapabilities` must
 * already include `capabilityId`'s own row plus its parent and grandparent,
 * if any (`loadCapabilityAncestry` below fetches exactly that, in the same
 * "at most a grandparent lookup" shape `capabilityLevel`'s own doc comment
 * describes). `null` for the identical two reasons `capabilityLevel`
 * itself returns `null`: the id isn't a capability this caller loaded at
 * all, or its chain doesn't resolve to a clean level within 3 — shown as a
 * gap (an "Unassigned"-shaped lane), never silently misplaced.
 */
export function l1AncestorOf(capabilityId: UUID, allCapabilities: ReadonlyMap<UUID, ElementsHeadRow>): ElementsHeadRow | null {
  const capability = allCapabilities.get(capabilityId);
  if (!capability) return null;
  if (capability.parent_id === null) return capability;
  const parent = allCapabilities.get(capability.parent_id);
  if (!parent) return null;
  if (parent.parent_id === null) return parent;
  const grandparent = allCapabilities.get(parent.parent_id);
  if (!grandparent) return null;
  return grandparent.parent_id === null ? grandparent : null;
}

/**
 * `rootId`'s own subtree, `rootId` itself included — a capability's parent
 * is always another capability or null (V2), and nesting is capped at 3
 * levels (ADR-016), but this walk doesn't lean on that cap: it's a plain
 * breadth-first walk over `parent_id`, guarded against ever revisiting an
 * id, so it terminates cleanly regardless of depth.
 *
 * Moved here (Sprint U4-2, "capability rollup") from
 * `src/ui/landscape/capabilityLandscapeRows.ts`, its original home — this
 * file is the established "capability tree structure, consumed
 * cross-feature" home (`l1AncestorOf`'s own ancestor walk is already used
 * by landscape code from here), and the new shared capability-rollup module
 * (`src/ui/capabilityMap/capabilityRollup.ts`) needed the same descendant
 * walk without taking a dependency on `src/ui/landscape/`.
 */
export function capabilitySubtreeIds(rootId: UUID, allCapabilities: readonly ElementsHeadRow[]): Set<UUID> {
  const childrenByParentId = new Map<UUID, UUID[]>();
  for (const capability of allCapabilities) {
    if (capability.parent_id === null) continue;
    const children = childrenByParentId.get(capability.parent_id) ?? [];
    children.push(capability.element_id);
    childrenByParentId.set(capability.parent_id, children);
  }
  const ids = new Set<UUID>([rootId]);
  let frontier = [rootId];
  while (frontier.length > 0) {
    const next: UUID[] = [];
    for (const id of frontier) {
      for (const childId of childrenByParentId.get(id) ?? []) {
        if (!ids.has(childId)) {
          ids.add(childId);
          next.push(childId);
        }
      }
    }
    frontier = next;
  }
  return ids;
}

/**
 * Fetches whatever `l1AncestorOf` needs beyond `leafCapabilities` itself —
 * each one's parent, then grandparent, stopping as soon as a level's worth
 * of ids all resolve to root capabilities (`parent_id === null`) or two
 * rounds have run (capability nesting is capped at 3 levels, ADR-016 — a
 * grandparent is as deep as this can ever need to go). `byIds` abstracts
 * over the two sources landscape data already comes from — a real
 * `getElementsByIds` round trip for `main`/a tag, or a change branch's own
 * in-memory projection (`projectionElementsByIds`, wrapped in
 * `Promise.resolve` by the caller) — so this same walk serves both without
 * caring which.
 */
export async function loadCapabilityAncestry(
  byIds: (ids: readonly UUID[]) => Promise<Map<UUID, ElementsHeadRow>>,
  leafCapabilities: ReadonlyMap<UUID, ElementsHeadRow>,
): Promise<Map<UUID, ElementsHeadRow>> {
  const all = new Map(leafCapabilities);
  let frontier = [...leafCapabilities.values()];
  for (let round = 0; round < 2 && frontier.length > 0; round++) {
    const parentIds = [...new Set(frontier.map((c) => c.parent_id).filter((id): id is UUID => id !== null))].filter((id) => !all.has(id));
    if (parentIds.length === 0) break;
    const parents = await byIds(parentIds);
    for (const [id, row] of parents) all.set(id, row);
    frontier = [...parents.values()];
  }
  return all;
}
