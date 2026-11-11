import type { DeltaRow, FactsRow } from '../../../contracts/rows';
import type { CapabilityMapRow } from '../../../db/capabilityMapTemplates';
import type { SourceRow } from '../../../db/types';
import { formatRelativeTime } from '../../time';
import { Button } from '../Button/Button';
import { ConfidenceDots } from '../ConfidenceDots/ConfidenceDots';
import { Text } from '../Text/Text';
import styles from './ProvenanceCard.module.css';

export type FactHistory = { status: 'loading' } | { status: 'error' } | { status: 'ready'; deltas: DeltaRow[]; sources: Map<string, SourceRow> };

export interface ProvenanceCardProps {
  fact: FactsRow;
  source: SourceRow | undefined;
  history: FactHistory;
  onRetryHistory: () => void;
  /**
   * Sprint U4-1 D2: "Show on the provenance card as 'Seeded from
   * electricity_network v1'". `null` either while `FactBadge`'s own lazy
   * fetch hasn't resolved yet, or when `source` isn't a `template`-kind
   * source at all (the overwhelmingly common case) — either way, nothing
   * renders; this is additional context for a seeded fact, not a
   * required field every card must show.
   */
  seededFrom: CapabilityMapRow | null;
  now?: Date;
}

/**
 * The answer to "why do we believe this" (UI-principles §4.3): source,
 * kind, `source_ref`, effective/recorded dates, confidence as a number,
 * and the supersession chain. The current evidence remains visible while
 * the chain loads or if that request fails.
 *
 * Prompt 7h bug fix: "recorded/effective as precise relative time or
 * date" — the Effective/Recorded rows use `formatRelativeTime`
 * (minutes/hours/yesterday/date), not the coarse monthly staleness
 * bucket `ProvenanceBadge`'s own compact badge still uses for its
 * stale-colour threshold; a card the viewer is already hovering to read
 * closely can afford (and asked for) the precise answer.
 */
export function ProvenanceCard({ fact, source, history, onRetryHistory, seededFrom, now = new Date() }: ProvenanceCardProps) {
  const effectiveDateStr = fact.effective_date ?? fact.asserted_at;
  const recordedDateStr = fact.asserted_at;

  return (
    <div className={styles.card}>
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
      {seededFrom && (
        <Text size="sm" tone="muted" as="p" className={styles.seededFrom}>
          Seeded from {seededFrom.sector} v{seededFrom.version}
        </Text>
      )}
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
          {formatRelativeTime(effectiveDateStr, now)}
        </Text>
      </div>
      <div className={styles.row}>
        <Text size="sm" tone="muted" as="span">
          Recorded
        </Text>
        <Text size="sm" as="span">
          {formatRelativeTime(recordedDateStr, now)}
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
      <div className={styles.chain}>
        {history.status === 'loading' && <div role="status"><Text size="sm" tone="muted">Loading history…</Text></div>}
        {history.status === 'error' && (
          <>
            <div role="alert"><Text size="sm">Couldn’t load earlier evidence.</Text></div>
            <Button variant="secondary" onClick={onRetryHistory}>Retry history</Button>
          </>
        )}
        {history.status === 'ready' && (history.deltas.length === 0 ? (
          <Text size="sm" tone="muted">No earlier evidence.</Text>
        ) : (
          <>
            <Text size="sm" tone="muted">Previously</Text>
            {history.deltas.map((delta) => (
              <Text key={delta.id} size="sm" tone="muted" as="p" className={styles.chainEntry}>
                {JSON.stringify(delta.value)} — {history.sources.get(delta.source_id)?.name ?? 'Unknown source'}
              </Text>
            ))}
          </>
        ))}
      </div>
    </div>
  );
}
