import type { SourceKind } from '../../../contracts/sources';
import { isStale } from '../../../contracts/thresholds';
import { formatAge } from '../../time';
import { ConfidenceDots } from '../ConfidenceDots/ConfidenceDots';
import styles from './ProvenanceBadge.module.css';

const SOURCE_GLYPH: Record<SourceKind, string> = {
  spreadsheet: '▤',
  document: '▣',
  interview: '🗣',
  manual: '👤',
  capture_job: '⚙',
  template: '⌂',
  merge_resolution: '⇄',
  // ADR-025: a value confirmed as still accurate.
  attestation: '✓',
};

export interface ProvenanceBadgeProps {
  sourceKind: SourceKind;
  /** The fact's `effective_date` if set, else the delta's commit time (§4.3). */
  date: Date;
  /** 0–1. Human assertion is 1.0. */
  confidence: number;
  now?: Date;
}

/**
 * The badge anatomy from UI-principles.md §4.3: source glyph, age (turns to
 * the warning colour past `STALE_AFTER_MONTHS`), confidence dots — fixed
 * layout so badge columns align down an attribute list. This is the
 * compact inline badge only; the hover provenance card (source, `source_ref`,
 * supersession chain) is real element/delta data and is built with the
 * element page (Sprint U1 step 3), not a design-tokens-step primitive.
 */
export function ProvenanceBadge({ sourceKind, date, confidence, now = new Date() }: ProvenanceBadgeProps) {
  const stale = isStale(date, now);
  const ageLabel = formatAge(date, now);
  return (
    <span className={styles.badge} title={`${sourceKind}, ${ageLabel} old`}>
      <span aria-hidden="true">{SOURCE_GLYPH[sourceKind]}</span>
      <span className={stale ? styles.staleAge : styles.age}>{ageLabel}</span>
      <span className={styles.separator} aria-hidden="true">
        ·
      </span>
      <ConfidenceDots confidence={confidence} />
    </span>
  );
}
