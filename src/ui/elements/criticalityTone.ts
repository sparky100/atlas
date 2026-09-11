import type { Criticality } from '../../contracts/delta';
import type { ChipTone } from '../components/Chip/Chip';

/**
 * The one criticality→tone mapping used everywhere a system's `criticality`
 * gets a colour (the element page's own attribute badge via
 * `AttributesTable`'s generic enum rendering, and — Prompt 7k item 1 — the
 * landscape/capability-map colour-by modes) — same "extracted once a
 * second caller needed it" reasoning `lifecycleTone.ts`'s own history
 * gives.
 */
export const CRITICALITY_TONE: Record<Criticality, ChipTone> = { critical: 'danger', high: 'warn', medium: 'info', low: 'neutral' };

/**
 * `low → medium → high → critical`, as a sortable order rather than enum
 * declaration order — "worst-of" (capability-map colour-by, Prompt 7k
 * item 1) means the most-severe criticality found among a capability's
 * supporting systems, the same "oldest lifecycle stage" shape
 * `lifecycleTone.ts`'s own `LIFECYCLE_ORDER` already gives `oldestLifecycleStage`.
 */
export const CRITICALITY_ORDER: Record<Criticality, number> = { low: 0, medium: 1, high: 2, critical: 3 };

export function criticalityToneFor(value: string): ChipTone | undefined {
  return value in CRITICALITY_TONE ? CRITICALITY_TONE[value as Criticality] : undefined;
}
