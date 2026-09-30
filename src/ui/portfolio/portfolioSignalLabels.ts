/**
 * Short display labels for each Portfolio signal, plus the fixed key order
 * every filter/legend walks — shared between `PortfolioSignalChip.tsx`
 * (the chip's own short text) and `PortfolioToolbar.tsx` (the signal
 * filter's own options), so the two can never show a different label for
 * the same signal.
 */
import type { PortfolioSignalKey } from './portfolioSignals';

export const PORTFOLIO_SIGNAL_KEYS: readonly PortfolioSignalKey[] = ['costly_poor_fit', 'costly_low_criticality', 'costly_exposed', 'costly_overlap', 'cheap_poor_fit', 'justified'];

export const PORTFOLIO_SIGNAL_LABEL: Record<PortfolioSignalKey, string> = {
  costly_poor_fit: 'Costly, poor fit',
  costly_low_criticality: 'Costly, low criticality',
  costly_exposed: 'Costly, exposed',
  costly_overlap: 'Costly overlap',
  cheap_poor_fit: 'Cheap, poor fit',
  justified: 'Justified',
};
