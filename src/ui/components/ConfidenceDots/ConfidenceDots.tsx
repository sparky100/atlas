import { confidenceBand } from '../../../contracts/thresholds';
import styles from './ConfidenceDots.module.css';

export interface ConfidenceDotsProps {
  /** 0–1. A human assertion is always 1.0 and reads `●●●` (§4.3). */
  confidence: number;
}

const FILLED_COUNT: Record<ReturnType<typeof confidenceBand>, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

/**
 * Three dots, filled by confidence band (§4.3, thresholds in
 * src/contracts/thresholds.ts). Deliberately monochrome (`--text` filled /
 * `--border-strong` empty) — "confidence is a count, not a judgement"
 * (§8.4), so it never borrows the status/diff colour vocabularies.
 */
export function ConfidenceDots({ confidence }: ConfidenceDotsProps) {
  const filled = FILLED_COUNT[confidenceBand(confidence)];
  const label = `confidence ${String(Math.round(confidence * 100))}%`;
  return (
    <span className={styles.dots} role="img" aria-label={label} title={label}>
      {[0, 1, 2].map((i) => (
        <span key={i} className={i < filled ? styles.filled : styles.empty} aria-hidden="true" />
      ))}
    </span>
  );
}
