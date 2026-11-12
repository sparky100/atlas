import { createContext, useContext } from 'react';
import { STALE_AFTER_MONTHS } from '../../contracts/thresholds';

/** The organisation's own stale threshold in months, provided once for every model route (`ModelRouteGate`); outside one, the default. */
export const StaleAfterMonthsContext = createContext<number>(STALE_AFTER_MONTHS);

export function useStaleAfterMonths(): number {
  return useContext(StaleAfterMonthsContext);
}
