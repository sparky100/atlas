import type { FitForPurpose } from '../../contracts/delta';
import type { ChipTone } from '../components/Chip/Chip';

/**
 * The one fit-for-purpose→tone mapping used everywhere a supports edge's
 * `fitForPurpose` gets a colour (the element page's own relationship row
 * chip, and the capability map's `metric:fitForPurpose` colour-by mode) —
 * same "extracted once a second caller needed it" reasoning
 * `criticalityTone.ts`'s own history gives. `poor` is the one value the
 * human explicitly fixed to `danger`; the other three are the escalation a
 * rating naturally reads as: `excellent` = clean green, `good` = nothing to
 * flag, `adequate` = borderline worth attention, `poor` = failing.
 */
export const FIT_FOR_PURPOSE_TONE: Record<FitForPurpose, ChipTone> = { excellent: 'ok', good: 'ok', adequate: 'warn', poor: 'warn' };

/**
 * `excellent → good → adequate → poor`, as a sortable order where a higher
 * number is *worse* — "worst-of" (capability-map colour-by) means the
 * worst fit found among a capability's supporting edges, the same
 * "higher = worse, worst-of = max" shape `criticalityTone.ts`'s own
 * `CRITICALITY_ORDER` already gives `worstCriticality`. Deliberately the
 * reverse of the enum declaration order (`'poor' | 'adequate' | 'good' |
 * 'excellent'`), which is not itself a meaningful ordering.
 */
export { FIT_FOR_PURPOSE_ORDER } from '../../engine/elementRead/fitForPurpose';

/** Whether an arbitrary string (e.g. from a `supports` edge's jsonb attributes) is a real `FitForPurpose` rating. */
export function isFitForPurpose(value: string): value is FitForPurpose {
  return value in FIT_FOR_PURPOSE_TONE;
}

/** The tone for a validated rating — call `isFitForPurpose` first when the value came from untyped storage. */
export function fitForPurposeToneFor(value: FitForPurpose): ChipTone {
  return FIT_FOR_PURPOSE_TONE[value];
}
