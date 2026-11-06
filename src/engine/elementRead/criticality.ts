import type { Criticality } from '../../contracts/delta';

/** Criticality worst-of order, low to critical. */
export const CRITICALITY_ORDER: Record<Criticality, number> = { low: 0, medium: 1, high: 2, critical: 3 };
