/**
 * The Portfolio view's own signal chips — each a pure, named combination
 * of cost, fit, criticality and lifecycle exposure, never cost alone (the
 * task's own "an excellent-fit, critical system can rightly be expensive"
 * stance). A missing input — unrated fit, unset cost, unrecorded
 * criticality, or unknown exposure — never triggers a signal on its own
 * or as part of a combination; `missingPortfolioInputs` reports exactly
 * which inputs a row is missing, so the view can say so rather than
 * silently reading a gap as a comfortable value.
 *
 * `overlapCapabilityNames` arrives already resolved to display names —
 * this module stays free of any id/lookup concern (`portfolioOverlap.ts`
 * owns the id-level computation; the caller resolves names before calling
 * here), so every signal in this file is checkable from plain, literal
 * inputs alone.
 */
import type { Criticality, Disposition, FitForPurpose } from '../../contracts/delta';
import type { AnnualRunCost } from '../../contracts/delta';
import { CRITICALITY_ORDER } from '../elements/criticalityTone';
import { isCheapCostBand, isHighCostBand } from './portfolioOverlap';

export type PortfolioSignalKey = 'costly_poor_fit' | 'costly_low_criticality' | 'costly_exposed' | 'costly_overlap' | 'cheap_poor_fit' | 'invest_poor_fit' | 'tolerate_costly_poor_fit' | 'justified';

export interface PortfolioSignal {
  key: PortfolioSignalKey;
  /** A calm, non-alarming signal — `justified` is the one case today — renders with a neutral/informational tone instead of a warning one. */
  calm: boolean;
  reason: string;
}

export interface PortfolioSignalInput {
  cost: AnnualRunCost | null;
  fit: FitForPurpose | null;
  criticality: Criticality | null;
  /** `null` means exposure can't be determined either way (no row in this system's own family has a recorded `plannedEnd`) — distinct from a real `false`. */
  lifecycleExposed: boolean | null;
  /** Names of capabilities (already resolved by the caller) that make this row's own top-level system one of two-or-more high-cost supporters — empty when there's no overlap. */
  overlapCapabilityNames: readonly string[];
  /** F11: this row's own recorded disposition (never inherited) — `null` when not assessed, which never fires a disposition signal. Not one of `missingPortfolioInputs`: the cost/fit signals don't need it. */
  disposition: Disposition | null;
}

/** high or critical — the task's own motivating example ("an excellent-fit, critical system can rightly be expensive") names a *critical* system as the calm case, so `justified` reads at or above `high`, not `high` alone. */
function isJustifyingCriticality(criticality: Criticality | null): boolean {
  return criticality !== null && CRITICALITY_ORDER[criticality] >= CRITICALITY_ORDER.high;
}

/** Which of this row's own signal inputs are missing — the view's own "this row's picture is incomplete" text reads straight off this list, never inferred from a signal simply not firing. */
export function missingPortfolioInputs(input: Pick<PortfolioSignalInput, 'cost' | 'fit' | 'criticality' | 'lifecycleExposed'>): string[] {
  const missing: string[] = [];
  if (input.cost === null) missing.push('run cost');
  if (input.fit === null) missing.push('fit');
  if (input.criticality === null) missing.push('criticality');
  if (input.lifecycleExposed === null) missing.push('lifecycle exposure');
  return missing;
}

/** Every signal that fires for this row, most-notable first — a row can show more than one at once (e.g. costly+poor-fit and costly+overlap together), `justified` is the only one ever mutually exclusive with the rest (it requires a good/excellent fit, which none of the warning signals ever do). */
export function computePortfolioSignals(input: PortfolioSignalInput): PortfolioSignal[] {
  const signals: PortfolioSignal[] = [];
  const highCost = isHighCostBand(input.cost);
  const cheapCost = isCheapCostBand(input.cost);

  if (highCost && (input.fit === 'poor' || input.fit === 'adequate')) {
    signals.push({ key: 'costly_poor_fit', calm: false, reason: `High run cost with a ${input.fit} fit rating.` });
  }

  if (highCost && input.criticality === 'low') {
    signals.push({ key: 'costly_low_criticality', calm: false, reason: 'High run cost for a system rated low criticality.' });
  }

  if (highCost && input.lifecycleExposed === true) {
    signals.push({ key: 'costly_exposed', calm: false, reason: 'High run cost and lifecycle-exposed (nearing or past planned end).' });
  }

  if (highCost && input.overlapCapabilityNames.length > 0) {
    const list = input.overlapCapabilityNames.join(', ');
    signals.push({ key: 'costly_overlap', calm: false, reason: `High run cost, and shares another high-cost supporter for: ${list}.` });
  }

  if (cheapCost && input.fit === 'poor') {
    signals.push({ key: 'cheap_poor_fit', calm: false, reason: 'Low run cost despite a poor fit rating.' });
  }

  // F11: where the recorded disposition disagrees with the recorded facts.
  // Both need the disposition *and* the facts they compare against — a
  // missing input never fires either one.
  if (input.disposition === 'invest' && input.fit === 'poor') {
    signals.push({ key: 'invest_poor_fit', calm: false, reason: 'Marked Invest, but rated a poor fit.' });
  }

  if (input.disposition === 'tolerate' && highCost && (input.fit === 'poor' || input.fit === 'adequate')) {
    signals.push({ key: 'tolerate_costly_poor_fit', calm: false, reason: `Marked Tolerate, with high run cost and a ${input.fit} fit rating.` });
  }

  if (highCost && (input.fit === 'good' || input.fit === 'excellent') && isJustifyingCriticality(input.criticality) && input.criticality !== null) {
    signals.push({ key: 'justified', calm: true, reason: `High run cost, but a ${input.fit} fit on a ${input.criticality} criticality system.` });
  }

  return signals;
}
