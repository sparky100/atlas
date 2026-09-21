import type { UUID } from '../../contracts/delta';
import { CollapsibleSection } from '../components/CollapsibleSection/CollapsibleSection';
import { Text } from '../components/Text/Text';
import type { ValueStreamRow } from './useValueStreams';
import type { ValueStreamTone } from './valueStreamRollup';
import styles from './ValueStreamsView.module.css';

const TONE_LABEL: Record<ValueStreamTone, string> = {
  ok: 'no known exposure',
  warn: 'lifecycle exposure',
  info: 'replacement planned',
  neutral: 'nothing recorded',
};

export interface ValueStreamsViewProps {
  rows: readonly ValueStreamRow[];
  selectedStageId: UUID | null;
  onInspectStage: (stageId: UUID) => void;
}

/**
 * The Value streams page's own desktop rendering (F6/ADR-023, "one row per
 * stream, stages left to right as tiles coloured by the rollup"). Tone is
 * never colour-only (§8.7): each stage tile pairs its dot with the plain
 * word `TONE_LABEL` gives it, the same `FactIndicator` shape
 * `CapabilityMapView.tsx` already established. Tapping a stage opens the
 * shared Inspector (`ValueStreamsPage.tsx` owns `selectedStageId`) rather
 * than navigating — the stage's own element page is still one click away
 * from there ("Open stage →").
 *
 * Inactive streams (`ADR-023`: deactivated, never deleted) collapse into
 * their own section rather than cluttering the primary list — same
 * "collapsed, not hidden" treatment `RelationshipsSection.tsx`'s own
 * retracted rows use elsewhere in this codebase.
 */
export function ValueStreamsView({ rows, selectedStageId, onInspectStage }: ValueStreamsViewProps) {
  const active = rows.filter((row) => !row.inactive);
  const inactive = rows.filter((row) => row.inactive);

  if (rows.length === 0) {
    return (
      <Text as="p" tone="muted">
        No value streams recorded yet.
      </Text>
    );
  }

  return (
    <div className={styles.streams}>
      {active.map((row) => (
        <StreamRow key={row.stream.element_id} row={row} selectedStageId={selectedStageId} onInspectStage={onInspectStage} />
      ))}
      {inactive.length > 0 && (
        <CollapsibleSection title={`Inactive (${String(inactive.length)})`} defaultOpen={false}>
          <div className={styles.streams}>
            {inactive.map((row) => (
              <StreamRow key={row.stream.element_id} row={row} selectedStageId={selectedStageId} onInspectStage={onInspectStage} />
            ))}
          </div>
        </CollapsibleSection>
      )}
    </div>
  );
}

function StreamRow({ row, selectedStageId, onInspectStage }: { row: ValueStreamRow; selectedStageId: UUID | null; onInspectStage: (stageId: UUID) => void }) {
  return (
    <div className={styles.streamRow}>
      <div className={styles.streamHeader}>
        <Text as="h2" size="lg">
          {row.stream.name}
        </Text>
        <span className={styles.factIndicator}>
          <span className={styles.factDot} data-tone={row.rollup.tone} aria-hidden="true" />
          <Text as="span" size="sm" tone="muted">
            {TONE_LABEL[row.rollup.tone]}
          </Text>
        </span>
      </div>
      <div className={styles.stages}>
        {row.stages.length === 0 ? (
          <Text as="p" size="sm" tone="muted">
            No stages recorded.
          </Text>
        ) : (
          row.stages.map((stage) => (
            <button
              key={stage.stage.element_id}
              type="button"
              className={styles.stageTile}
              data-selected={selectedStageId === stage.stage.element_id ? 'true' : undefined}
              onClick={() => {
                onInspectStage(stage.stage.element_id);
              }}
            >
              <span className={styles.factDot} data-tone={stage.tone} aria-hidden="true" />
              <Text as="span" size="sm" className={styles.stageName}>
                {stage.stage.name}
              </Text>
              <Text as="span" size="xs" tone="muted">
                {TONE_LABEL[stage.tone]}
              </Text>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
