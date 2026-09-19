/**
 * "Platforms and modules": a platform's own Container children get their
 * own landscape tile, labelled "{platform name} · {module name}" so a
 * module's own row never reads as a bare, out-of-context name —
 * `moduleDisplayName`'s own naming (`src/ui/elements/moduleDisplayName.ts`,
 * the one shared implementation every surface that can show a module name
 * uses), applied here to a whole row list so `useCapabilityLandscape.ts`
 * (Sprint U4-2c item 2's flat list, which resolves only the specific
 * systems/modules its own supports edges name, never the whole model's
 * systems and containers) can relabel its own rows without duplicating it.
 */
import type { UUID } from '../../contracts/delta';
import type { ElementsHeadRow } from '../../contracts/rows';
import { moduleDisplayName } from '../elements/moduleDisplayName';

/**
 * `rows`, relabelled — a Container whose `parent_id` names a platform in
 * `parentsById` comes back as a shallow copy with `name` rewritten to
 * "{platform} · {module}"; every other row (an ordinary system, or a
 * container with no platform parent, e.g. `parentsById` not covering it)
 * is returned unchanged, same object.
 */
export function withModuleLabels(rows: readonly ElementsHeadRow[], parentsById: ReadonlyMap<UUID, ElementsHeadRow>): ElementsHeadRow[] {
  return rows.map((row) => {
    if (row.element_type !== 'container' || row.parent_id === null) return row;
    const parent = parentsById.get(row.parent_id) ?? null;
    const name = moduleDisplayName(row, parent);
    return name === row.name ? row : { ...row, name };
  });
}
