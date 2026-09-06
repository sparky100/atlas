import type { DeltaRow, FactsRow } from '../../../contracts/rows';
import { monthsSince } from '../../../contracts/thresholds';
import type { SourceRow } from '../../../db/types';
import { ConfidenceDots } from '../ConfidenceDots/ConfidenceDots';
import { Text } from '../Text/Text';
import styles from './ProvenanceCard.module.css';

function formatAge(date: Date, now: Date): string {
  const months = monthsSince(date, now);
  if (months < 1) return '< 1mo ago';
  if (months < 24) return `${String(months)}mo ago`;
  return `${String(Math.floor(months / 12))}y ago`;
}

export interface ProvenanceCardProps {
  fact: FactsRow;
  source: SourceRow | undefined;
  /** [currentFact's own delta, ...supersededDeltas], oldest last. `null` while still loading (fetched lazily on first hover/focus) — the top-level fields render immediately either way; only the "Previously" section waits. */
  supersessionChain: DeltaRow[] | null;
  supersessionSources: Map<string, SourceRow>;
  now?: Date;
}

/**
 * The answer to "why do we believe this" (UI-principles §4.3): source,
 * kind, `source_ref`, effective/recorded dates, confidence as a number,
 * and the supersession chain. One hover or focus away from every value on
 * every screen, per §4.3 — this component is the shared implementation;
 * canvas tooltips (step 4) reuse it too.
 */
export function ProvenanceCard({ fact, source, supersessionChain, supersessionSources, now = new Date() }: ProvenanceCardProps) {
  const effectiveDate = fact.effective_date ? new Date(fact.effective_date) : new Date(fact.asserted_at);
  const recordedDate = new Date(fact.asserted_at);
  const superseded = supersessionChain?.filter((d) => d.id !== fact.delta_id) ?? null;

  return (
    <div className={styles.card} role="tooltip">
      <div className={styles.row}>
        <Text size="sm" tone="muted" as="span">
          Source
        </Text>
        <Text size="sm" as="span">
          {source?.name ?? 'Unknown source'}
        </Text>
      </div>
      <div className={styles.row}>
        <Text size="sm" tone="muted" as="span">
          Kind
        </Text>
        <Text size="sm" as="span">
          {source?.kind ?? '—'}
        </Text>
      </div>
      {fact.source_ref !== null && (
        <div className={styles.row}>
          <Text size="sm" tone="muted" as="span">
            Reference
          </Text>
          <Text size="sm" mono as="span">
            {fact.source_ref}
          </Text>
        </div>
      )}
      <div className={styles.row}>
        <Text size="sm" tone="muted" as="span">
          Effective
        </Text>
        <Text size="sm" as="span">
          {formatAge(effectiveDate, now)}
        </Text>
      </div>
      <div className={styles.row}>
        <Text size="sm" tone="muted" as="span">
          Recorded
        </Text>
        <Text size="sm" as="span">
          {formatAge(recordedDate, now)}
        </Text>
      </div>
      <div className={styles.row}>
        <Text size="sm" tone="muted" as="span">
          Confidence
        </Text>
        <span className={styles.confidenceValue}>
          <ConfidenceDots confidence={fact.confidence} />
          <Text size="sm" as="span">
            {fact.confidence.toFixed(2)}
          </Text>
        </span>
      </div>
      {superseded === null ? (
        <Text size="xs" tone="faint" as="p" className={styles.chainEntry}>
          Loading history…
        </Text>
      ) : (
        superseded.length > 0 && (
          <div className={styles.chain}>
            <Text size="xs" tone="muted" as="span">
              Previously
            </Text>
            {superseded.map((delta) => (
              <Text key={delta.id} size="xs" tone="muted" as="p" className={styles.chainEntry}>
                {JSON.stringify(delta.value)} — {supersessionSources.get(delta.source_id)?.name ?? delta.source_id}
              </Text>
            ))}
          </div>
        )
      )}
    </div>
  );
}
