import type { DeltaRow, FactsRow } from '../../../contracts/rows';
import type { CapabilityMapRow } from '../../../db/capabilityMapTemplates';
import type { SourceRow } from '../../../db/types';
import { formatRelativeTime } from '../../time';
import { ConfidenceDots } from '../ConfidenceDots/ConfidenceDots';
import { Text } from '../Text/Text';
import styles from './ProvenanceCard.module.css';

export interface ProvenanceCardProps {
  fact: FactsRow;
  source: SourceRow | undefined;
  /** [currentFact's own delta, ...supersededDeltas], oldest last. `null` while still loading (fetched lazily on first hover/focus) — the top-level fields render immediately either way; only the "Previously" section waits. */
  supersessionChain: DeltaRow[] | null;
  supersessionSources: Map<string, SourceRow>;
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
 * and the supersession chain. One hover or focus away from every value on
 * every screen, per §4.3 — this component is the shared implementation;
 * canvas tooltips (step 4) reuse it too.
 *
 * Prompt 7h bug fix: "recorded/effective as precise relative time or
 * date" — the Effective/Recorded rows use `formatRelativeTime`
 * (minutes/hours/yesterday/date), not the coarse monthly staleness
 * bucket `ProvenanceBadge`'s own compact badge still uses for its
 * stale-colour threshold; a card the viewer is already hovering to read
 * closely can afford (and asked for) the precise answer.
 */
export function ProvenanceCard({ fact, source, supersessionChain, supersessionSources, seededFrom, now = new Date() }: ProvenanceCardProps) {
  const effectiveDateStr = fact.effective_date ?? fact.asserted_at;
  const recordedDateStr = fact.asserted_at;
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
