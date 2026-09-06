import type { LifecycleStatus } from '../../contracts/delta';
import type { ChipTone } from '../components/Chip/Chip';

/**
 * The one lifecycle→tone mapping used everywhere a lifecycle status gets a
 * colour (ElementHeader, StructureSection, and — Sprint U2 — the
 * capability map's "oldest lifecycle stage" colour-by mode). Extracted
 * here once a third caller needed it, same as attributesRecord.ts's own
 * history.
 */
export const LIFECYCLE_TONE: Record<LifecycleStatus, ChipTone> = { planned: 'info', active: 'ok', retiring: 'warn', retired: 'neutral' };

/**
 * `planned → active → retiring → retired`, as a sortable order rather than
 * a fixed enum position — "oldest" (capability map colour-by) means the
 * most-advanced stage found among a capability's supporting systems, not
 * the enum's declaration order.
 */
export const LIFECYCLE_ORDER: Record<LifecycleStatus, number> = { planned: 0, active: 1, retiring: 2, retired: 3 };

export function lifecycleToneFor(status: string): ChipTone | undefined {
  return status in LIFECYCLE_TONE ? LIFECYCLE_TONE[status as LifecycleStatus] : undefined;
}
