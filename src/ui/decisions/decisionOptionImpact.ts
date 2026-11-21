/**
 * "The diagram should show a bit like the diff... by default only make
 * visible those capabilities that are impacted, which in turn is driven by
 * the related systems." A decision option's landscape (`DecisionOptionLandscapePage.tsx`)
 * is `useLandscape` pointed at the option's own branch in `mode: 'diff'` —
 * already exactly "what did this option change" (UI-principles §6.2/§6.3's
 * `VersionDiff`, the same one `LandscapeCanvas`'s own diff tinting already
 * reads). This module is the one new piece: which lanes count as
 * "impacted," so every other lane can be handed to `layout.ts`'s own
 * `hiddenLaneKeys` (the "hide" feature this builds on) as the view's
 * computed default, never a saved preference.
 *
 * A lane is impacted when at least one *system* it places (primary or
 * secondary — `laneKeysBySystemId`'s own "every lane a system touches")
 * changed — either the system element itself (added/changed/removed/moved)
 * or one of its own `supports`/`uses`/`flows_to`/`owns` edges
 * (added/changed/removed). Element-only diffing would miss the common case
 * of an option that only re-points a `supports` edge to a different
 * capability, with the system's own element row otherwise untouched.
 * A capability element's own diff state (e.g. a renamed capability) is
 * deliberately not consulted directly — "driven by the related systems"
 * per the request that shaped this, not by whether the capability node
 * itself changed.
 */
import type { UUID } from '../../contracts/delta';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import type { VersionDiff } from '../../engine/versionDiff';
import { forLandscapeDisplay } from '../../engine/versionDiff';
import { laneKeysBySystemId } from '../landscape/landscapeFilter';
import { groupSystemsByLane } from '../landscape/layout';

/** Every system id this option's diff actually touches — its own element row changed, or one of its edges did. */
function changedSystemIds(diff: VersionDiff, systemIds: ReadonlySet<UUID>): Set<UUID> {
  const changed = new Set<UUID>();
  for (const e of diff.elements) {
    if (e.state !== 'unchanged' && systemIds.has(e.elementId)) changed.add(e.elementId);
  }
  for (const r of diff.relationships) {
    if (r.state === 'unchanged') continue;
    const endpoints = [r.asIs?.fromElementId, r.asIs?.toElementId, r.toBe?.fromElementId, r.toBe?.toElementId];
    for (const id of endpoints) {
      if (id !== undefined && systemIds.has(id)) changed.add(id);
    }
  }
  return changed;
}

/**
 * The systems a diff diagram may honestly call touched. Changed system
 * records and both system ends of a changed connection are included; a
 * neighbouring system is context only when the connection itself changed.
 * A whole capability lane is never a substitute for this set.
 */
export function optionImpactSystemIds(diff: VersionDiff, systemIds: ReadonlySet<UUID>): Set<UUID> {
  return changedSystemIds(forLandscapeDisplay(diff), systemIds);
}

/**
 * Every lane key touched by a changed system — the impacted set this
 * view's own default-hidden computation is the complement of. `systems`/
 * `supportsEdges`/`l1AncestorByCapabilityId` are the option branch's own
 * `useLandscape` data (its `toBe` state — the same inputs
 * `listLandscapeLaneOptions`/`computeLandscapeLayout` already take), not
 * main's.
 */
export function impactedLaneKeys(
  diff: VersionDiff,
  systems: readonly ElementsHeadRow[],
  supportsEdges: readonly RelationshipsHeadRow[],
  l1AncestorByCapabilityId: ReadonlyMap<UUID, ElementsHeadRow>,
): Set<string> {
  const systemIds = new Set(systems.map((s) => s.element_id));
  const changed = changedSystemIds(diff, systemIds);
  const grouping = groupSystemsByLane(systems, supportsEdges, l1AncestorByCapabilityId);
  const laneKeysById = laneKeysBySystemId(grouping);
  const impacted = new Set<string>();
  for (const id of changed) {
    for (const key of laneKeysById.get(id) ?? []) impacted.add(key);
  }
  return impacted;
}

/**
 * Lane keys for the decision's own scope, shown while an option has no edits yet so the diagram is the
 * affected capability and systems as they are today, not every lane hidden. A system in scope counts,
 * and so does any system that supports a capability in scope. `scopeElementIds` is what the decision
 * concerns (capabilities and systems); the other inputs are the same landscape data as `impactedLaneKeys`.
 */
export function scopeLaneKeys(
  scopeElementIds: ReadonlySet<UUID>,
  systems: readonly ElementsHeadRow[],
  supportsEdges: readonly RelationshipsHeadRow[],
  l1AncestorByCapabilityId: ReadonlyMap<UUID, ElementsHeadRow>,
): Set<string> {
  const inScope = new Set<UUID>();
  for (const s of systems) if (scopeElementIds.has(s.element_id)) inScope.add(s.element_id);
  for (const e of supportsEdges) if (scopeElementIds.has(e.to_element_id)) inScope.add(e.from_element_id);
  const grouping = groupSystemsByLane(systems, supportsEdges, l1AncestorByCapabilityId);
  const laneKeysById = laneKeysBySystemId(grouping);
  const keys = new Set<string>();
  for (const id of inScope) for (const key of laneKeysById.get(id) ?? []) keys.add(key);
  return keys;
}
