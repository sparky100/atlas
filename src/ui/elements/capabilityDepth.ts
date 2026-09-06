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
