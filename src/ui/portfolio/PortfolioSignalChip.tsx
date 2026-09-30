import { Chip, type ChipTone } from '../components/Chip/Chip';
import { PORTFOLIO_SIGNAL_LABEL } from './portfolioSignalLabels';
import type { PortfolioSignal } from './portfolioSignals';

/** `calm` (`justified` today) reads as `ok` — a settled, non-alarming tone; every other signal is advisory, not an error, so `warn` rather than `danger`. */
function toneFor(signal: PortfolioSignal): ChipTone {
  return signal.calm ? 'ok' : 'warn';
}

export function PortfolioSignalChip({ signal }: { signal: PortfolioSignal }) {
  return (
    <span title={signal.reason}>
      <Chip tone={toneFor(signal)}>{PORTFOLIO_SIGNAL_LABEL[signal.key]}</Chip>
    </span>
  );
}
