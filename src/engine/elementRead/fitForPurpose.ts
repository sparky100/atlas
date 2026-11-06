import type { FitForPurpose } from '../../contracts/delta';

/** `excellent → good → adequate → poor`, higher is worse ("worst-of = max"). Deliberately the reverse of the enum declaration order. */
export const FIT_FOR_PURPOSE_ORDER: Record<FitForPurpose, number> = { excellent: 0, good: 1, adequate: 2, poor: 3 };
